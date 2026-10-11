/** Server-PT: a host running DHCP, DNS, HTTP, SMTP/POP3/IMAP and SSH services. */
import { Host, HOST_PORT, DHCP_SERVER_PORT, DNS_PORT } from './host.ts';
import type { HostOs } from './host.ts';
import type { IpPacket, AppPayload, DhcpMessage, MailMessage } from '../net/packets.ts';
import { DHCP_CLIENT_PORT } from '../net/packets.ts';
import type { Peer } from '../net/tcp.ts';
import { DhcpServer } from '../dhcp/server.ts';
import type { ServerReply } from '../dhcp/server.ts';
import { defaultServices } from '../services/config.ts';
import type { ServerServices } from '../services/config.ts';
import { applyPtPools } from '../services/dhcp-pt.ts';
import { answerQuery } from '../services/dns-service.ts';
import { cleanOrigin, effectiveRecords } from '../services/dns-names.ts';
import { serveHttp, SERVER_BANNER, IIS_BANNER } from '../services/http-service.ts';
import { Mailboxes, handleSmtp, handleRetrieve } from '../services/mail-service.ts';
import type { MailEnv } from '../services/mail-service.ts';
import { findUnit, setUnitActive, unitActive, UNITS } from '../services/units.ts';
import type { UnitId } from '../services/units.ts';
import { SshService } from '../services/ssh-service.ts';
import { firstAddress } from '../net/dns.ts';
import { BROADCAST_IP, formatIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import type { SimClock } from '../core/clock.ts';

export interface LogEntry {
  readonly time: number;
  readonly unit: UnitId;
  readonly line: string;
}

const MAX_LOG = 400;
const SMTP_PORT = 25;
const POP3_PORT = 110;
const IMAP_PORT = 143;
const HTTP_PORT = 80;
const SSH_PORT = 22;

export class Server extends Host {
  readonly kind = 'server' as const;
  override os: HostOs = 'linux';
  services: ServerServices = defaultServices();
  /** Units enabled at boot (`systemctl enable`, Windows "Automatic"). */
  autostart: Record<UnitId, boolean> = { dhcp: true, dns: true, http: true, smtp: true, mailbox: true, ssh: true };
  readonly dhcpEngine = new DhcpServer();
  readonly mailboxes = new Mailboxes();
  readonly logs: LogEntry[] = [];
  readonly ssh: SshService;

  constructor(id: string, name: string, clock: SimClock, seed: number) {
    super(id, name, clock, seed);
    this.ssh = new SshService(this);
    this.applyServices();
  }

  // ------------------------------------------------------------ configuration

  setServices(next: ServerServices): void {
    const before = this.services;
    this.services = next;
    this.applyServices();
    for (const u of UNITS) {
      const was = unitActive(before, u.id);
      const now = unitActive(next, u.id);
      if (was !== now) this.log(u.id, now ? `Started ${u.description}.` : `Stopped ${u.description}.`);
    }
    this.changed();
  }

  setUnit(id: UnitId, on: boolean): void {
    this.setServices(setUnitActive(this.services, id, on));
  }

  unitByName(name: string): UnitId | undefined {
    return findUnit(name)?.id;
  }

  private applyServices(): void {
    const s = this.services;
    applyPtPools(this.dhcpEngine, s.dhcp.pools, s.dhcp.enabled);
    this.toggle(HTTP_PORT, s.http.enabled, (req, peer) => this.onHttp(req, peer));
    this.toggle(SMTP_PORT, s.mail.smtp, (req, peer) => (req.app === 'SMTP' && req.kind === 'request' ? handleSmtp(this.mailEnv(), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(POP3_PORT, s.mail.pop3, (req, peer) => (req.app === 'POP3' && req.kind === 'request' ? handleRetrieve(this.mailEnv(), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(IMAP_PORT, s.mail.imap, (req, peer) => (req.app === 'IMAP' && req.kind === 'request' ? handleRetrieve(this.mailEnv(), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(SSH_PORT, s.ssh.enabled, (req, peer) => this.ssh.handle(req, peer));
    if (!s.ssh.enabled) this.ssh.closeAll();
  }

  private toggle(port: number, on: boolean, handler: (req: AppPayload, peer: Peer) => AppPayload | null): void {
    if (on) this.tcp.listen(port, handler);
    else this.tcp.unlisten(port);
  }

  log(unit: UnitId, line: string): void {
    this.logs.push({ time: this.clock.now(), unit, line });
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG);
  }

  journal(unit: UnitId): LogEntry[] {
    return this.logs.filter((l) => l.unit === unit);
  }

  // ------------------------------------------------------------ HTTP

  private onHttp(req: AppPayload, peer: Peer): AppPayload | null {
    if (req.app !== 'HTTP' || req.kind !== 'request') return null;
    const res = serveHttp(this.services.http.files, req, this.os === 'windows' ? IIS_BANNER : SERVER_BANNER);
    this.log('http', `${formatIp(peer.ip)} - - "${req.method} ${req.path} HTTP/1.1" ${res.status} ${res.body.length}`);
    return res;
  }

  // ------------------------------------------------------------ mail

  private mailEnv(): MailEnv {
    const m = this.services.mail;
    return {
      domain: m.domain,
      users: m.users,
      hostname: this.name,
      log: (line) => this.log(line.startsWith('dovecot') ? 'mailbox' : 'smtp', line),
      relay: (domain, mail, done) => this.relayMail(domain, mail, done),
    };
  }

  /** MX lookup, then A lookup of the exchange, then SMTP to it. */
  private relayMail(domain: string, mail: MailMessage, done: (ok: boolean, reason: string) => void): void {
    this.lookup(domain, 'MX', (mx) => {
      const exchange = mx.kind === 'answer' ? [...(mx.msg.answers ?? [])].filter((a) => a.type === 'MX').sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0]?.data : undefined;
      const target = exchange ?? domain;
      this.lookup(target, 'A', (a) => {
        const ip = a.kind === 'answer' ? firstAddress(a.msg) : undefined;
        if (ip === undefined) {
          done(false, `Host or domain name not found. Name service error for name=${domain} type=MX`);
          return;
        }
        if (this.ownsIp(ip)) {
          done(false, `mail for ${domain} loops back to myself`);
          return;
        }
        this.connect(ip, SMTP_PORT, { app: 'SMTP', kind: 'request', helo: this.name, mail }, (r) => {
          const ok = r.kind === 'ok' && r.reply.app === 'SMTP' && r.reply.kind === 'reply' && r.reply.code === '250';
          const why = r.kind === 'ok' && r.reply.kind === 'reply' ? `${r.reply.code} ${r.reply.text}` : `connect to ${formatIp(ip)}:25: ${r.kind}`;
          done(ok, `relay=${target}[${formatIp(ip)}]:25, ${why}`);
        });
      });
    });
  }

  // ------------------------------------------------------------ UDP services

  protected onUdp(packet: IpPacket): void {
    const udp = packet.udp;
    if (!udp) return;
    if (udp.dport === DHCP_SERVER_PORT && udp.dhcp && udp.dhcp.op === 'BOOTREQUEST') this.onDhcp(udp.dhcp);
    else if (udp.dport === DNS_PORT && udp.dns && !udp.dns.response && this.services.dns.enabled) {
      const answer = answerQuery(udp.dns, effectiveRecords(this.services.dns), cleanOrigin(this.services.dns.origin));
      this.log('dns', `client ${formatIp(packet.src)}#${udp.sport} (${udp.dns.qname}): query: ${udp.dns.qname} IN ${udp.dns.qtype} + (${formatIp(packet.dst)}) → ${answer.rcode}`);
      this.sendUdp(packet.src, DNS_PORT, udp.sport, { dns: answer });
    }
  }

  private onDhcp(msg: DhcpMessage): void {
    const { ip, prefix } = this.config;
    if (ip === undefined || prefix === undefined) return;
    const reply = this.dhcpEngine.handle(msg, {
      ifaceName: HOST_PORT,
      ifaceAddrs: [{ ip, prefix }],
      ownIps: [ip],
      now: this.clock.now(),
      ipInUse: () => false,
      log: (l) => this.log('dhcp', l),
    });
    if (!reply) {
      if (this.services.dhcp.enabled) this.log('dhcp', `DHCP4_PACKET_DROP: no pool for client ${formatMacCisco(msg.chaddr)} (${msg.options.messageType})`);
      return;
    }
    this.logDhcp(msg, reply);
    this.sendDhcpReply(reply);
  }

  private logDhcp(req: DhcpMessage, reply: ServerReply): void {
    const hw = formatMacCisco(req.chaddr);
    const type = reply.msg.options.messageType;
    const ip = formatIp(reply.msg.yiaddr);
    if (type === 'OFFER') this.log('dhcp', `DHCP4_LEASE_ADVERT [hwtype=1 ${hw}], tid=0x${req.xid.toString(16)}: lease ${ip} will be advertised`);
    else if (type === 'ACK') this.log('dhcp', `DHCP4_LEASE_ALLOC [hwtype=1 ${hw}], tid=0x${req.xid.toString(16)}: lease ${ip} has been allocated for ${reply.msg.options.leaseSeconds ?? 0} seconds`);
    else if (type === 'NAK') this.log('dhcp', `DHCP4_PACKET_NAK [hwtype=1 ${hw}]: requested address rejected`);
  }

  private sendDhcpReply(reply: ServerReply): void {
    const m = reply.msg;
    if (reply.via === 'relay') this.sendUdp(m.giaddr, DHCP_SERVER_PORT, DHCP_SERVER_PORT, { dhcp: m });
    else if (reply.via === 'unicast') this.sendUdp(m.ciaddr, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, { dhcp: m });
    else this.sendUdp(BROADCAST_IP, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, { dhcp: m });
  }
}
