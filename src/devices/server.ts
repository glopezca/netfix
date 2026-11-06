/** Server: a host running DHCP, DNS, HTTP, SMTP/POP3/IMAP and SSH services. */
import { dnsListensOn, listenChoices, listens } from '../services/listen.ts';
import { Host, DHCP_SERVER_PORT, DNS_PORT } from './host.ts';
import type { HostOs } from './host.ts';
import type { IpPacket, AppPayload, DhcpMessage, MailMessage } from '../net/packets.ts';
import { DHCP_CLIENT_PORT } from '../net/packets.ts';
import type { Peer } from '../net/tcp.ts';
import { DhcpServer } from '../dhcp/server.ts';
import type { ServerReply } from '../dhcp/server.ts';
import { defaultServices } from '../services/config.ts';
import type { ServerServices } from '../services/config.ts';
import { applyPtPools } from '../services/dhcp-pt.ts';
import { ServerDns } from '../services/dns-server.ts';
import { ServerWeb } from './server-web.ts';
import { Mailboxes, handleSmtp, handleRetrieve } from '../services/mail-service.ts';
import { mailEnv, SMTP_PORT } from './server-mail.ts';
import { findUnit, setUnitActive, unitActive, unitById, unitTitle, UNITS } from '../services/units.ts';
import type { UnitId, UnitInfo } from '../services/units.ts';
import { SshService } from '../services/ssh-service.ts';
import { unitCheck } from './unit-checks.ts';
import { journalLines } from './journal-text.ts';
import { loadNftablesConf } from './server-firewall.ts';
import { BROADCAST_IP, formatIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import type { SimClock } from '../core/clock.ts';

/** journald's priorities that journalctl colours (the rest are info). */
export type LogPriority = 'err' | 'warning' | 'notice';

export interface LogMeta {
  readonly priority?: LogPriority;
  /** Who wrote the line (`systemd[1]`, `apachectl[1123]`); the unit's own process when missing. */
  readonly ident?: string;
}

export interface LogEntry extends LogMeta {
  readonly time: number;
  readonly unit: UnitId;
  readonly line: string;
}

/** A unit whose start failed (systemd's "failed (Result: exit-code)"): since when, and how its process exited. */
export interface UnitFailure {
  readonly time: number;
  readonly status: string;
}

const SYSTEMD = 'systemd[1]';
/** rndc as named.service's ExecReload. */
const RNDC = 'rndc[1311]';
/** systemd's default: five starts within 10 s, then the unit stays failed. */
const START_LIMIT_BURST = 5;

const MAX_LOG = 400;
const POP3_PORT = 110;
const IMAP_PORT = 143;
const SSH_PORT = 22;

export class Server extends Host {
  readonly kind: 'server' | 'linuxrouter';
  override os: HostOs = 'linux';
  services: ServerServices = defaultServices();
  /** Units enabled at boot (`systemctl enable`, Windows "Automatic"). */
  autostart: Record<UnitId, boolean> = { dhcp: true, dns: true, http: true, smtp: true, mailbox: true, ssh: true, firewall: false };
  readonly dhcpEngine = new DhcpServer();
  readonly mailboxes = new Mailboxes();
  readonly logs: LogEntry[] = [];
  /** Units left failed by a start that failed, until a good start or `systemctl reset-failed`. */
  failed: Partial<Record<UnitId, UnitFailure>> = {};
  readonly ssh: SshService;
  readonly dns: ServerDns;
  readonly web: ServerWeb = new ServerWeb(this);

  /** `kind` is set before anything else so the lazily built system (programs, files) sees the right one. */
  constructor(id: string, name: string, clock: SimClock, seed: number, kind: 'server' | 'linuxrouter' = 'server') {
    super(id, name, clock, seed);
    this.kind = kind;
    this.ssh = new SshService(this);
    this.dns = new ServerDns(this);
    this.applyServices();
  }

  // ------------------------------------------------------------ configuration

  /** Starts and stops what changed, logged as systemd 257 does; a unit whose start fails stays stopped, failed. */
  setServices(requested: ServerServices): void {
    const before = this.services;
    let next: ServerServices;
    try {
      next = this.startStop(before, requested);
    } catch (err) {
      this.services = before;
      throw err;
    }
    if (before.firewall.enabled && !next.firewall.enabled) this.kernel.netfilter.flush();
    this.services = next;
    this.applyServices();
    for (const u of UNITS) if (!unitActive(before, u.id) && unitActive(next, u.id)) this.logStarted(u);
    this.changed();
  }

  /** Stops and starts the units whose state changes (a failed start is left off); a throw puts the model back. */
  private startStop(before: ServerServices, requested: ServerServices): ServerServices {
    let next = requested;
    for (const u of UNITS) {
      const was = unitActive(before, u.id);
      if (was === unitActive(next, u.id)) continue;
      if (was) this.logStop(u);
      else {
        // Type=simple (Kea): systemd says Started once it runs the process, nothing before.
        if (!u.simple) this.systemd(u.id, `Starting ${unitTitle(u)}...`);
        // The start reads the files generated from the requested model (a lab loaded, or Servicios saving and starting).
        this.services = next;
        next = this.startUnit(u, next) ?? setUnitActive(next, u.id, false);
      }
    }
    return next;
  }

  private logStop(u: UnitInfo): void {
    this.systemd(u.id, `Stopping ${unitTitle(u)}...`);
    this.systemd(u.id, `${u.linux}.service: Deactivated successfully.`);
    this.systemd(u.id, `Stopped ${unitTitle(u)}.`);
  }

  /** A good start ends the failed state. */
  private logStarted(u: UnitInfo): void {
    const { [u.id]: _, ...rest } = this.failed;
    this.failed = rest;
    this.systemd(u.id, `${u.oneshot ? 'Finished' : 'Started'} ${unitTitle(u)}.`);
  }

  /** What a unit's start runs: the services it leaves, or null when its process exits with an error (in the journal). */
  private startUnit(u: UnitInfo, next: ServerServices): ServerServices | null {
    if (u.id === 'http') return this.startWeb() ? next : null;
    if (u.id === 'ssh') return this.startSsh() ? next : null;
    if (u.id === 'firewall') return this.startFirewall() ? next : null;
    const check = unitCheck(u.id, this);
    if (check.ok) {
      if (check.ident && check.lines) this.logLines(u.id, check.ident, check.lines);
      return check.apply ? check.apply(next) : next;
    }
    if (u.simple) this.systemd(u.id, `Started ${unitTitle(u)}.`);
    this.logLines(u.id, check.ident, check.lines);
    this.failStart(u.id);
    if (u.restart) this.restartLimit(u, check.ident, check.lines);
    return null;
  }

  /** Restart=on-failure: systemd starts it again (the files have not changed) until StartLimitBurst stops it. */
  private restartLimit(u: UnitInfo, ident: string, lines: readonly string[]): void {
    const service = `${u.linux}.service`;
    for (let n = 1; n < START_LIMIT_BURST; n++) {
      this.systemd(u.id, `${service}: Scheduled restart job, restart counter is at ${n}.`);
      this.systemd(u.id, `Starting ${unitTitle(u)}...`);
      this.logLines(u.id, ident, lines);
      this.failStart(u.id);
    }
    this.systemd(u.id, `${service}: Scheduled restart job, restart counter is at ${START_LIMIT_BURST}.`);
    this.systemd(u.id, `${service}: Start request repeated too quickly.`, 'warning');
    this.systemd(u.id, `${service}: Failed with result 'exit-code'.`, 'warning');
    this.systemd(u.id, `Failed to start ${unitTitle(u)}.`, 'err');
  }

  /** A line systemd itself writes in the unit's journal. */
  private systemd(unit: UnitId, line: string, priority?: LogPriority): void {
    this.log(unit, line, { ident: SYSTEMD, ...(priority ? { priority } : {}) });
  }

  /** systemd after the start's process exited with an error: the unit is left failed. */
  private failStart(id: UnitId): void {
    const u = unitById(id);
    const status = u.start?.status ?? '1/FAILURE';
    this.systemd(id, `${u.linux}.service: ${u.start?.control ? 'Control' : 'Main'} process exited, code=exited, status=${status}`, 'notice');
    this.systemd(id, `${u.linux}.service: Failed with result 'exit-code'.`, 'warning');
    // A Type=simple unit had started: its main process exiting is not a failed start job.
    if (!u.simple) this.systemd(id, `Failed to start ${unitTitle(u)}.`, 'err');
    this.failed = { ...this.failed, [id]: { time: this.clock.now(), status } };
  }

  /** systemd after an ExecReload that failed: the unit keeps running with what it had. */
  private failReload(id: UnitId): void {
    const u = unitById(id);
    this.systemd(id, `${u.linux}.service: Control process exited, code=exited, status=1/FAILURE`, 'notice');
    this.systemd(id, `Reload failed for ${unitTitle(u)}.`, 'err');
  }

  private logReloaded(id: UnitId): void {
    const u = unitById(id);
    this.systemd(id, `Reloading ${unitTitle(u)}...`);
    this.systemd(id, `Reloaded ${unitTitle(u)}.`);
  }

  /** `systemctl reset-failed [unit]`: forgets the failure (the unit is inactive from then on). */
  resetFailed(id?: UnitId): void {
    if (id === undefined) this.failed = {};
    else {
      const { [id]: _, ...rest } = this.failed;
      this.failed = rest;
    }
  }

  /** The lines a program writes to its journal (its stdout and stderr). */
  private logLines(unit: UnitId, ident: string, lines: readonly string[]): void {
    for (const line of lines) this.log(unit, line, { ident });
  }

  /** ssh.service's ExecStartPre (sshd -t) checks /etc/ssh/sshd_config and the host key; an error leaves it failed. */
  private startSsh(): boolean {
    const err = this.ssh.reload();
    if (!err) return true;
    this.logLines('ssh', 'sshd[701]', err.split('\n'));
    this.failStart('ssh');
    return false;
  }

  /** nftables.service start: `nft -f /etc/nftables.conf`; an error leaves it failed. */
  private startFirewall(): boolean {
    if (this.os === 'windows') return true;
    const err = loadNftablesConf(this);
    if (!err) return true;
    this.logLines('firewall', 'nft[655]', err.split('\n'));
    this.failStart('firewall');
    return false;
  }

  /** systemctl reload nftables: loads the file again; on error the running ruleset stays. */
  reloadFirewall(): string | null {
    const err = this.os === 'windows' ? null : loadNftablesConf(this);
    if (err) {
      this.logLines('firewall', 'nft[655]', err.split('\n'));
      this.failReload('firewall');
      return err;
    }
    this.logReloaded('firewall');
    return null;
  }

  /** systemctl reload ssh: new sshd_config for new connections, or the running one on error. */
  reloadSsh(): string | null {
    const err = this.ssh.reload();
    if (err) {
      this.logLines('ssh', 'sshd[701]', err.split('\n'));
      this.failReload('ssh');
      return err;
    }
    this.logReloaded('ssh');
    return null;
  }

  /**
   * `systemctl reload named` (ExecReload=rndc reload) or rndc itself: named reads its files again and keeps what it
   * had when named.conf does not load. Returns the error, or null.
   */
  reloadDns(bySystemd = true): string | null {
    const u = unitById('dns');
    if (bySystemd) this.systemd('dns', `Reloading ${unitTitle(u)}...`);
    const check = unitCheck('dns', this, 'reload');
    if (check.ident && check.lines) this.logLines('dns', check.ident, check.lines);
    if (!check.ok) {
      if (!bySystemd) return 'failure';
      this.log('dns', "rndc: 'reload' failed: failure", { ident: RNDC });
      this.failReload('dns');
      return 'failure';
    }
    if (bySystemd) {
      this.log('dns', 'server reload successful', { ident: RNDC });
      this.systemd('dns', `Reloaded ${unitTitle(u)}.`);
    }
    if (check.apply) this.setServices(check.apply(this.services));
    return null;
  }

  /** Starting Apache (apachectl start) reads /etc/apache2; a configuration error leaves it failed. */
  private startWeb(): boolean {
    if (this.os === 'windows') return true;
    const err = this.web.reload();
    if (!err) return true;
    this.logWebError(err, 'start');
    this.failStart('http');
    return false;
  }

  private logWebError(err: string, action: 'start' | 'graceful'): void {
    this.logLines('http', 'apachectl[1123]', [...err.split('\n'), `Action '${action}' failed.`, 'The Apache error log may have more information.']);
  }

  /** systemctl reload apache2 (apachectl graceful): applies the new configuration, or keeps the running one on error. */
  reloadWeb(): string | null {
    if (this.os === 'windows') return null;
    const err = this.web.reload();
    if (err) {
      this.logWebError(err, 'graceful');
      this.failReload('http');
      return err;
    }
    this.logReloaded('http');
    this.applyServices();
    this.changed();
    return null;
  }

  setUnit(id: UnitId, on: boolean): void {
    this.setServices(setUnitActive(this.services, id, on));
  }

  unitByName(name: string): UnitId | undefined { return findUnit(name)?.id; }

  private applyServices(): void {
    const s = this.services;
    applyPtPools(this.dhcpEngine, s.dhcp.pools, s.dhcp.enabled);
    this.web.sync();
    this.toggle(SMTP_PORT, s.mail.smtp, (req, peer) => (req.app === 'SMTP' && req.kind === 'request' ? handleSmtp(mailEnv(this), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(POP3_PORT, s.mail.pop3, (req, peer) => (req.app === 'POP3' && req.kind === 'request' ? handleRetrieve(mailEnv(this), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(IMAP_PORT, s.mail.imap, (req, peer) => (req.app === 'IMAP' && req.kind === 'request' ? handleRetrieve(mailEnv(this), this.mailboxes, req, formatIp(peer.ip)) : null));
    this.toggle(SSH_PORT, s.ssh.enabled, (req, peer) => this.ssh.handle(req, peer));
    if (!s.ssh.enabled) this.ssh.closeAll();
  }

  private toggle(port: number, on: boolean, handler: (req: AppPayload, peer: Peer) => AppPayload | null): void {
    if (on) this.tcp.listen(port, handler);
    else this.tcp.unlisten(port);
  }

  /** A message in the unit's journal: one entry per line (journal-text.ts). */
  log(unit: UnitId, text: string, meta: LogMeta = {}): void {
    for (const line of journalLines(text)) this.logs.push({ time: this.clock.now(), unit, line, ...meta });
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG);
  }

  journal(unit: UnitId): LogEntry[] {
    return this.logs.filter((l) => l.unit === unit);
  }

  // ------------------------------------------------------------ mail

  /** Mail submitted by a local program (webmail): the same rules as SMTP from 127.0.0.1. */
  submitMail(mail: MailMessage): { ok: boolean; text: string } {
    const r = handleSmtp(mailEnv(this), this.mailboxes, { app: 'SMTP', kind: 'request', helo: 'localhost', mail }, '127.0.0.1');
    return { ok: r.code === '250', text: `${r.code} ${r.text}` };
  }

  /** Checks a mail account (Dovecot login), as webmail does through IMAP. */
  mailLogin(user: string, password: string): boolean {
    return this.services.mail.users.some((u) => u.name.toLowerCase() === user.toLowerCase() && u.password === password);
  }

  // ------------------------------------------------------------ UDP services

  dnsListensOn(dst: number): boolean {
    return dnsListensOn(this.services.dns, listenChoices(this, true), dst);
  }

  protected override onUdp(packet: IpPacket, iface: string): void {
    const udp = packet.udp;
    if (!udp) return;
    if (udp.dport === DHCP_SERVER_PORT && udp.dhcp && udp.dhcp.op === 'BOOTREQUEST') this.onDhcp(udp.dhcp, iface);
    else if (udp.dns) this.dns.handle(packet);
  }

  /** DHCP on the NIC the request came in through (a relay's requests come to the main address). */
  private onDhcp(msg: DhcpMessage, arrived: string): void {
    const port = this.portNames().includes(arrived) ? arrived : this.primaryPort();
    // Kea's interfaces-config: no socket on the other interfaces.
    if (!listens(this.services.dhcp.interfaces, this.linuxIfName(port))) return;
    const { ip, prefix } = this.ifaceConfig(port) ?? {};
    if (ip === undefined || prefix === undefined) return;
    const reply = this.dhcpEngine.handle(msg, {
      ifaceName: port,
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
    this.sendDhcpReply(reply, port);
  }

  private logDhcp(req: DhcpMessage, reply: ServerReply): void {
    const hw = formatMacCisco(req.chaddr);
    const type = reply.msg.options.messageType;
    const ip = formatIp(reply.msg.yiaddr);
    if (type === 'OFFER') this.log('dhcp', `DHCP4_LEASE_ADVERT [hwtype=1 ${hw}], tid=0x${req.xid.toString(16)}: lease ${ip} will be advertised`);
    else if (type === 'ACK') this.log('dhcp', `DHCP4_LEASE_ALLOC [hwtype=1 ${hw}], tid=0x${req.xid.toString(16)}: lease ${ip} has been allocated for ${reply.msg.options.leaseSeconds ?? 0} seconds`);
    else if (type === 'NAK') this.log('dhcp', `DHCP4_PACKET_NAK [hwtype=1 ${hw}]: requested address rejected`);
  }

  private sendDhcpReply(reply: ServerReply, port: string): void {
    const m = reply.msg;
    if (reply.via === 'relay') this.sendUdp(m.giaddr, DHCP_SERVER_PORT, DHCP_SERVER_PORT, { dhcp: m });
    else if (reply.via === 'unicast') this.sendUdp(m.ciaddr, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, { dhcp: m });
    else this.sendUdp(BROADCAST_IP, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, { dhcp: m }, undefined, port);
  }
}
