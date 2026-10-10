/** RFC 2131 DHCP client state machine used by PCs, router interfaces and switch SVIs. */
import type { DhcpMessage, DhcpOptions } from '../net/packets.ts';
import { BROADCAST_IP } from '../core/ip.ts';

export type ClientState = 'STOPPED' | 'INIT' | 'SELECTING' | 'REQUESTING' | 'BOUND' | 'RENEWING' | 'REBINDING';

export interface Lease {
  readonly ip: number;
  readonly prefix: number;
  readonly serverId: number;
  readonly leaseSeconds: number;
  readonly obtainedAt: number;
  readonly routers: readonly number[];
  readonly dnsServers: readonly number[];
  readonly domainName?: string;
  readonly hostname?: string;
  readonly tftpServers?: readonly number[];
  readonly bootfile?: string;
  readonly nextServer?: number;
}

export interface ClientEnv {
  readonly mac: string;
  readonly clientId?: string;
  readonly hostname?: string;
  /** Sends a BOOTREQUEST; `dst` is 255.255.255.255 or the server address (renewal). */
  send(msg: DhcpMessage, dst: number, src: number): void;
  schedule(delayMs: number, fn: () => void): void;
  now(): number;
  onBound(lease: Lease): void;
  onFailed(): void;
  onLost(): void;
}

const RETRY_MS = 4000;
const MAX_ATTEMPTS = 4;
const MS = 1000;
const INFINITE = 0xffffffff;
const DEFAULT_PREFIX = 24;

export class DhcpClient {
  state: ClientState = 'STOPPED';
  lease: Lease | undefined;
  private xid = 0;
  private attempts = 0;
  private generation = 0;
  private offer: DhcpMessage | undefined;
  private readonly env: ClientEnv;

  constructor(env: ClientEnv) {
    this.env = env;
  }

  start(): void {
    this.generation++;
    this.lease = undefined;
    this.attempts = 0;
    this.discover();
  }

  stop(): void {
    this.generation++;
    this.state = 'STOPPED';
  }

  /** `ipconfig /release` / `release dhcp`: tells the server and forgets the lease. */
  release(): void {
    const lease = this.lease;
    this.stop();
    this.lease = undefined;
    if (!lease) return;
    this.env.send(this.message('RELEASE', { ciaddr: lease.ip, serverId: lease.serverId }), lease.serverId, lease.ip);
  }

  /** `ipconfig /renew` / `renew dhcp`. */
  renew(): void {
    if (this.lease && this.state === 'BOUND') {
      this.generation++;
      this.state = 'RENEWING';
      this.attempts = 0;
      this.sendRenew();
      return;
    }
    this.start();
  }

  receive(msg: DhcpMessage): void {
    if (msg.op !== 'BOOTREPLY' || msg.xid !== this.xid || msg.chaddr !== this.env.mac) return;
    const type = msg.options.messageType;
    if (type === 'OFFER' && this.state === 'SELECTING') this.onOffer(msg);
    else if (type === 'ACK' && (this.state === 'REQUESTING' || this.state === 'RENEWING' || this.state === 'REBINDING')) this.onAck(msg);
    else if (type === 'NAK' && this.state !== 'BOUND' && this.state !== 'STOPPED') this.onNak();
  }

  private discover(): void {
    this.state = 'SELECTING';
    this.xid = randomXid();
    this.offer = undefined;
    this.env.send(this.message('DISCOVER', {}), BROADCAST_IP, 0);
    this.retryLater(() => this.discover());
  }

  private onOffer(msg: DhcpMessage): void {
    this.offer = msg;
    this.state = 'REQUESTING';
    this.attempts = 0;
    this.generation++;
    this.sendRequest();
  }

  private sendRequest(): void {
    const offer = this.offer;
    if (!offer) return;
    this.env.send(this.message('REQUEST', { requestedIp: offer.yiaddr, serverId: offer.options.serverId }), BROADCAST_IP, 0);
    this.retryLater(() => this.sendRequest());
  }

  private sendRenew(): void {
    const lease = this.lease;
    if (!lease) return;
    this.env.send(this.message('REQUEST', { ciaddr: lease.ip }), lease.serverId, lease.ip);
    this.retryLater(() => this.sendRenew());
  }

  private retryLater(again: () => void): void {
    const gen = this.generation;
    this.env.schedule(RETRY_MS, () => {
      if (gen !== this.generation || this.state === 'BOUND' || this.state === 'STOPPED') return;
      this.attempts++;
      if (this.attempts < MAX_ATTEMPTS) {
        again();
        return;
      }
      const hadLease = this.lease !== undefined;
      this.state = 'INIT';
      this.generation++;
      if (hadLease) this.env.onLost();
      this.env.onFailed();
    });
  }

  private onAck(msg: DhcpMessage): void {
    const o = msg.options;
    const lease: Lease = {
      ip: msg.yiaddr || msg.ciaddr,
      prefix: o.subnetPrefix ?? DEFAULT_PREFIX,
      serverId: o.serverId ?? 0,
      leaseSeconds: o.leaseSeconds ?? 0,
      obtainedAt: this.env.now(),
      routers: o.routers ?? [],
      dnsServers: o.dnsServers ?? [],
      domainName: o.domainName,
      hostname: o.hostname,
      tftpServers: o.tftpServers,
      bootfile: msg.file,
      nextServer: msg.siaddr || undefined,
    };
    this.lease = lease;
    this.state = 'BOUND';
    this.generation++;
    this.env.onBound(lease);
    this.scheduleRenewal(lease);
  }

  private scheduleRenewal(lease: Lease): void {
    if (lease.leaseSeconds === 0 || lease.leaseSeconds >= INFINITE) return;
    const gen = this.generation;
    this.env.schedule((lease.leaseSeconds * MS) / 2, () => {
      if (gen !== this.generation || this.state !== 'BOUND') return;
      this.renew();
    });
  }

  private onNak(): void {
    const hadLease = this.lease !== undefined;
    this.lease = undefined;
    if (hadLease) this.env.onLost();
    this.start();
  }

  private message(type: DhcpOptions['messageType'], opts: { ciaddr?: number; requestedIp?: number; serverId?: number }): DhcpMessage {
    return {
      op: 'BOOTREQUEST', xid: this.xid, ciaddr: opts.ciaddr ?? 0, yiaddr: 0, siaddr: 0, giaddr: 0, chaddr: this.env.mac, broadcastFlag: false,
      options: { messageType: type, clientId: this.env.clientId, hostname: this.env.hostname, requestedIp: opts.requestedIp, serverId: opts.serverId },
    };
  }
}

let xidCounter = 0x3903f326;
function randomXid(): number {
  xidCounter = (Math.imul(xidCounter, 1664525) + 1013904223) >>> 0;
  return xidCounter;
}
