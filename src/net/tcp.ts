/**
 * Simplified TCP: every connection carries exactly one request and one reply.
 *
 *   client                     server
 *     SYN            ───────▶
 *                  ◀───────    SYN, ACK        (RST, ACK if nothing listens → refused)
 *     ACK, PSH + request ───▶
 *                  ◀───────    ACK, PSH, FIN + reply
 *     ACK            ───────▶
 *
 * Enough to show handshakes, refused ports and application data in simulation mode.
 */
import type { AppPayload, IcmpQuote, IpPacket, TcpFlag, TcpSegment, UnreachableCode } from './packets.ts';

export interface Peer {
  readonly ip: number;
  readonly port: number;
}

/** Returns the reply, or null to reset the connection. */
export type TcpHandler = (request: AppPayload, peer: Peer, localIp: number) => AppPayload | null;

export type TcpResult =
  | { readonly kind: 'ok'; readonly reply: AppPayload }
  | { readonly kind: 'refused' }
  /** An ICMP unreachable aborted the connect: net → ENETUNREACH, host or prohibited → EHOSTUNREACH. */
  | { readonly kind: 'unreachable'; readonly reason: 'net' | 'host' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'noroute' };

export interface TcpEnv {
  /** Routes and sends an IP packet; false when there is no route. */
  send(packet: IpPacket): boolean;
  /** Source address used to reach `dst`, or undefined without a route. */
  sourceFor(dst: number): number | undefined;
  schedule(delayMs: number, fn: () => void): void;
  readonly ttl: number;
}

/** Result of a port probe (connect scan): SYN-ACK, RST, or nothing before the timeout. */
export type ProbeResult = 'open' | 'closed' | 'filtered' | 'noroute' | 'netunreach' | 'hostunreach';

interface ClientConn {
  readonly remote: Peer;
  readonly localIp: number;
  /** Absent for a probe: the handshake is closed with RST as soon as it succeeds. */
  readonly payload?: AppPayload;
  readonly done: (r: TcpResult) => void;
  /** Probe: the handshake succeeded. */
  readonly opened?: () => void;
  seq: number;
  finished: boolean;
  /** The SYN-ACK arrived: past SYN_SENT, an ICMP error no longer aborts the connection (only a soft error on Linux). */
  synAcked?: boolean;
}

const FIRST_EPHEMERAL = 49152;
const LAST_EPHEMERAL = 65535;
const DEFAULT_TIMEOUT_MS = 5000;
const ISN_STEP = 64_000;

export class TcpLayer {
  private readonly env: TcpEnv;
  private readonly listeners = new Map<number, TcpHandler>();
  private readonly conns = new Map<number, ClientConn>();
  private nextPort = FIRST_EPHEMERAL;
  private isn = 1_000;

  constructor(env: TcpEnv) {
    this.env = env;
  }

  listen(port: number, handler: TcpHandler): void {
    this.listeners.set(port, handler);
  }

  unlisten(port: number): void {
    this.listeners.delete(port);
  }

  isListening(port: number): boolean {
    return this.listeners.has(port);
  }

  listeningPorts(): number[] {
    return [...this.listeners.keys()].sort((a, b) => a - b);
  }

  /** Opens a connection, sends `payload` and reports the reply through `done` (exactly once). */
  request(dst: number, dport: number, payload: AppPayload, done: (r: TcpResult) => void, timeoutMs = DEFAULT_TIMEOUT_MS): void {
    const localIp = this.env.sourceFor(dst);
    if (localIp === undefined) {
      done({ kind: 'noroute' });
      return;
    }
    const sport = this.allocatePort();
    const conn: ClientConn = { remote: { ip: dst, port: dport }, localIp, payload, done, seq: this.nextIsn(), finished: false };
    this.conns.set(sport, conn);
    this.emit(localIp, dst, { sport, dport, flags: ['SYN'], seq: conn.seq, ack: 0 });
    this.env.schedule(timeoutMs, () => {
      if (this.conns.get(sport) === conn) this.finish(sport, { kind: 'timeout' });
    });
  }

  /** Connect scan of one port (nc -z, nmap -sT): open, closed or filtered. */
  probe(dst: number, dport: number, done: (r: ProbeResult) => void, timeoutMs = DEFAULT_TIMEOUT_MS): void {
    const localIp = this.env.sourceFor(dst);
    if (localIp === undefined) {
      done('noroute');
      return;
    }
    const sport = this.allocatePort();
    const map = (r: TcpResult): ProbeResult => (r.kind === 'refused' ? 'closed' : r.kind === 'timeout' ? 'filtered'
      : r.kind === 'unreachable' ? (r.reason === 'net' ? 'netunreach' : 'hostunreach') : 'noroute');
    const conn: ClientConn = { remote: { ip: dst, port: dport }, localIp, done: (r) => done(map(r)), opened: () => done('open'), seq: this.nextIsn(), finished: false };
    this.conns.set(sport, conn);
    this.emit(localIp, dst, { sport, dport, flags: ['SYN'], seq: conn.seq, ack: 0 });
    this.env.schedule(timeoutMs, () => {
      if (this.conns.get(sport) === conn) this.finish(sport, { kind: 'timeout' });
    });
  }

  /** An ICMP unreachable quoting one of our SYNs: the connect fails (port unreachable = refused). */
  icmpUnreachable(orig: IcmpQuote, code: UnreachableCode): void {
    const conn = this.conns.get(orig.sport);
    if (!conn || conn.finished || conn.synAcked || conn.localIp !== orig.src || conn.remote.ip !== orig.dst || conn.remote.port !== orig.dport) return;
    this.finish(orig.sport, code === 'port' ? { kind: 'refused' } : { kind: 'unreachable', reason: code === 'net' ? 'net' : 'host' });
  }

  receive(packet: IpPacket): void {
    const seg = packet.tcp;
    if (!seg) return;
    const client = this.conns.get(seg.dport);
    if (client && client.remote.ip === packet.src && client.remote.port === seg.sport) {
      this.onClientSegment(seg.dport, client, seg);
      return;
    }
    this.onServerSegment(packet, seg);
  }

  // ------------------------------------------------------------ client side

  private onClientSegment(sport: number, conn: ClientConn, seg: TcpSegment): void {
    if (has(seg, 'RST')) {
      this.finish(sport, { kind: 'refused' });
      return;
    }
    if (has(seg, 'SYN') && has(seg, 'ACK')) {
      conn.seq += 1;
      conn.synAcked = true;
      if (!conn.payload) {
        this.emit(conn.localIp, conn.remote.ip, { sport, dport: conn.remote.port, flags: ['RST', 'ACK'], seq: conn.seq, ack: seg.seq + 1 });
        conn.finished = true;
        this.conns.delete(sport);
        conn.opened?.();
        return;
      }
      this.emit(conn.localIp, conn.remote.ip, { sport, dport: conn.remote.port, flags: ['ACK', 'PSH'], seq: conn.seq, ack: seg.seq + 1, data: conn.payload });
      return;
    }
    if (seg.data) {
      this.emit(conn.localIp, conn.remote.ip, { sport, dport: conn.remote.port, flags: ['ACK'], seq: conn.seq + 1, ack: seg.seq + 1 });
      this.finish(sport, { kind: 'ok', reply: seg.data });
    }
  }

  private finish(sport: number, result: TcpResult): void {
    const conn = this.conns.get(sport);
    if (!conn || conn.finished) return;
    conn.finished = true;
    this.conns.delete(sport);
    conn.done(result);
  }

  // ------------------------------------------------------------ server side

  private onServerSegment(packet: IpPacket, seg: TcpSegment): void {
    const reply = (flags: TcpFlag[], data?: AppPayload): void =>
      this.emit(packet.dst, packet.src, { sport: seg.dport, dport: seg.sport, flags, seq: this.nextIsn(), ack: seg.seq + 1, data });
    const handler = this.listeners.get(seg.dport);
    if (has(seg, 'SYN') && !has(seg, 'ACK')) {
      reply(handler ? ['SYN', 'ACK'] : ['RST', 'ACK']);
      return;
    }
    if (!seg.data) return;
    if (!handler) {
      reply(['RST', 'ACK']);
      return;
    }
    const answer = handler(seg.data, { ip: packet.src, port: seg.sport }, packet.dst);
    if (answer) reply(['ACK', 'PSH', 'FIN'], answer);
    else reply(['RST', 'ACK']);
  }

  // ------------------------------------------------------------ helpers

  private emit(src: number, dst: number, tcp: TcpSegment): void {
    this.env.send({ src, dst, ttl: this.env.ttl, protocol: 'tcp', tcp });
  }

  private allocatePort(): number {
    for (let i = 0; i <= LAST_EPHEMERAL - FIRST_EPHEMERAL; i++) {
      const port = this.nextPort;
      this.nextPort = port >= LAST_EPHEMERAL ? FIRST_EPHEMERAL : port + 1;
      if (!this.conns.has(port) && !this.listeners.has(port)) return port;
    }
    throw new Error('No free ephemeral ports');
  }

  private nextIsn(): number {
    this.isn = (this.isn + ISN_STEP) >>> 0;
    return this.isn;
  }
}

function has(seg: TcpSegment, flag: TcpFlag): boolean {
  return seg.flags.includes(flag);
}
