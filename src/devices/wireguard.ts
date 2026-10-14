/**
 * Runtime of a WireGuard interface (wg0): cryptokey routing, the handshake (initiation/response proved
 * with the X25519 shared secret and the optional preshared key), data messages that carry the inner
 * packet over UDP, endpoint roaming (NAT traversal) and persistent keepalives.
 */
import type { IpPacket, WgMessage } from '../net/packets.ts';
import type { Cidr, Endpoint, WgConfig, WgPeerConfig } from '../net/wg-config.ts';
import { inCidr, WG_DEFAULT_PORT } from '../net/wg-config.ts';
import { decodeKey, encodeKey, publicKeyOf, x25519 } from '../core/x25519.ts';
import { sha256, toBase64, utf8 } from '../core/sha256.ts';

export interface WgHost {
  now(): number;
  schedule(delayMs: number, fn: () => void): void;
  /** Sends the outer datagram through the main routing table (never through the tunnel itself). */
  sendUdp(dst: number, dport: number, sport: number, msg: WgMessage): void;
  /** A decrypted packet that arrived on the interface. */
  receiveInner(iface: string, inner: IpPacket): void;
}

interface Session {
  readonly local: number;
  readonly remote: number;
  readonly established: number;
}

export interface PeerState {
  endpoint?: Endpoint;
  session?: Session;
  pending?: { readonly sender: number; readonly at: number };
  queue: IpPacket[];
  rx: number;
  tx: number;
  lastHandshake?: number;
  counter: number;
}

export const REKEY_TIMEOUT_MS = 5_000;
export const REJECT_AFTER_MS = 180_000;
const MAX_QUEUE = 16;
const SIZE = { init: 148, resp: 92, keepalive: 32, overhead: 32 };
const MS = 1000;

/** Rough size of an IPv4 packet on the wire (for `transfer:`). */
export function packetSize(p: IpPacket): number {
  const IP = 20;
  if (p.tcp) return IP + 20 + (p.tcp.data ? 64 : 0);
  if (p.udp) return IP + 8 + 64;
  return IP + 64;
}

function randomIndex(): number {
  const out = new Uint32Array(1);
  globalThis.crypto.getRandomValues(out);
  return (out[0] ?? 1) || 1;
}

export class WgInterface {
  readonly name: string;
  config: WgConfig = { peers: [] };
  addresses: readonly Cidr[] = [];
  mtu = 1420;
  /** `ip link set wg0 up` (wg-quick does it after configuring). */
  up = false;
  readonly peers = new Map<string, PeerState>();
  private readonly host: WgHost;
  private generation = 0;

  constructor(name: string, host: WgHost) {
    this.name = name;
    this.host = host;
  }

  get listenPort(): number {
    return this.config.listenPort ?? WG_DEFAULT_PORT;
  }

  publicKey(): string | undefined {
    const priv = this.config.privateKey ? decodeKey(this.config.privateKey) : null;
    return priv ? encodeKey(publicKeyOf(priv)) : undefined;
  }

  /** `wg setconf`/`wg set`: new configuration; peers that stay keep their sessions. */
  setConfig(next: WgConfig): void {
    this.config = next;
    for (const key of [...this.peers.keys()]) if (!next.peers.some((p) => p.publicKey === key)) this.peers.delete(key);
    for (const p of next.peers) {
      const st = this.state(p.publicKey);
      if (p.endpoint) st.endpoint = p.endpoint;
    }
    this.startTimers();
  }

  state(key: string): PeerState {
    const found = this.peers.get(key);
    if (found) return found;
    const fresh: PeerState = { queue: [], rx: 0, tx: 0, counter: 0 };
    this.peers.set(key, fresh);
    return fresh;
  }

  /** Stops keepalives and drops sessions (`wg-quick down`, `ip link del`). */
  shutdown(): void {
    this.generation++;
    this.peers.clear();
  }

  /** Cryptokey routing: the peer whose AllowedIPs contains the address most specifically. */
  peerFor(ip: number): WgPeerConfig | undefined {
    let best: { peer: WgPeerConfig; prefix: number } | undefined;
    for (const peer of this.config.peers) {
      for (const c of peer.allowedIps) if (inCidr(c, ip) && (!best || c.prefix > best.prefix)) best = { peer, prefix: c.prefix };
    }
    return best?.peer;
  }

  /** Every AllowedIPs network (the routes wg-quick installs). */
  allowedNets(): Cidr[] {
    return this.config.peers.flatMap((p) => p.allowedIps);
  }

  /** A packet routed into wg0. false = no peer for it (ENOKEY). */
  send(inner: IpPacket): boolean {
    const peer = this.peerFor(inner.dst);
    if (!peer) return false;
    const st = this.state(peer.publicKey);
    if (this.fresh(st)) this.transmit(st, inner);
    else {
      st.queue = [...st.queue.slice(-(MAX_QUEUE - 1)), inner];
      this.initiate(peer, st);
    }
    return true;
  }

  private fresh(st: PeerState): boolean {
    return st.session !== undefined && this.host.now() - st.session.established < REJECT_AFTER_MS;
  }

  private transmit(st: PeerState, inner: IpPacket | undefined): void {
    if (!st.session || !st.endpoint) return;
    st.counter += 1;
    const msg: WgMessage = inner
      ? { kind: 'data', receiver: st.session.remote, counter: st.counter, inner }
      : { kind: 'keepalive', receiver: st.session.remote, counter: st.counter };
    st.tx += inner ? SIZE.overhead + packetSize(inner) : SIZE.keepalive;
    this.host.sendUdp(st.endpoint.ip, st.endpoint.port, this.listenPort, msg);
  }

  private shared(peerKey: string): string | undefined {
    const priv = this.config.privateKey ? decodeKey(this.config.privateKey) : null;
    const pub = decodeKey(peerKey);
    return priv && pub ? toBase64(x25519(priv, pub)) : undefined;
  }

  private proof(peer: WgPeerConfig, kind: 'init' | 'resp', sender: number, receiver = 0): string | undefined {
    const shared = this.shared(peer.publicKey);
    if (!shared) return undefined;
    return toBase64(sha256(utf8(`netfix-wg|${kind}|${shared}|${peer.presharedKey ?? ''}|${sender}|${receiver}`)));
  }

  private initiate(peer: WgPeerConfig, st: PeerState): void {
    const now = this.host.now();
    const me = this.publicKey();
    if (!st.endpoint || !me || (st.pending && now - st.pending.at < REKEY_TIMEOUT_MS)) return;
    const sender = randomIndex();
    const proof = this.proof(peer, 'init', sender);
    if (!proof) return;
    st.pending = { sender, at: now };
    st.tx += SIZE.init;
    this.host.sendUdp(st.endpoint.ip, st.endpoint.port, this.listenPort, { kind: 'initiation', sender, publicKey: me, proof });
  }

  /** A WireGuard datagram from `src:sport` to our listen port. */
  receive(src: number, sport: number, msg: WgMessage): void {
    if (msg.kind === 'initiation') this.onInitiation({ ip: src, port: sport }, msg);
    else if (msg.kind === 'response') this.onResponse({ ip: src, port: sport }, msg);
    else this.onData({ ip: src, port: sport }, msg);
  }

  private onInitiation(from: Endpoint, msg: Extract<WgMessage, { kind: 'initiation' }>): void {
    const peer = this.config.peers.find((p) => p.publicKey === msg.publicKey);
    const me = this.publicKey();
    if (!peer || !me || this.proof(peer, 'init', msg.sender) !== msg.proof) return;
    const st = this.state(peer.publicKey);
    const local = randomIndex();
    st.endpoint = from;
    st.session = { local, remote: msg.sender, established: this.host.now() };
    st.lastHandshake = this.host.now();
    st.pending = undefined;
    st.rx += SIZE.init;
    st.tx += SIZE.resp;
    this.host.sendUdp(from.ip, from.port, this.listenPort, { kind: 'response', sender: local, receiver: msg.sender, publicKey: me, proof: this.proof(peer, 'resp', local, msg.sender) ?? '' });
    this.flush(st);
  }

  private onResponse(from: Endpoint, msg: Extract<WgMessage, { kind: 'response' }>): void {
    const peer = this.config.peers.find((p) => p.publicKey === msg.publicKey);
    if (!peer) return;
    const st = this.state(peer.publicKey);
    if (st.pending?.sender !== msg.receiver || this.proof(peer, 'resp', msg.sender, msg.receiver) !== msg.proof) return;
    st.endpoint = from;
    st.session = { local: msg.receiver, remote: msg.sender, established: this.host.now() };
    st.lastHandshake = this.host.now();
    st.pending = undefined;
    st.rx += SIZE.resp;
    this.flush(st);
    if (!st.queue.length) this.transmit(st, undefined);
  }

  private flush(st: PeerState): void {
    const queued = st.queue;
    st.queue = [];
    for (const p of queued) this.transmit(st, p);
  }

  private onData(from: Endpoint, msg: Extract<WgMessage, { kind: 'data' | 'keepalive' }>): void {
    const entry = [...this.peers.entries()].find(([, s]) => s.session?.local === msg.receiver);
    const peer = entry && this.config.peers.find((p) => p.publicKey === entry[0]);
    if (!entry || !peer) return;
    const st = entry[1];
    st.endpoint = from;
    if (msg.kind === 'keepalive') {
      st.rx += SIZE.keepalive;
      return;
    }
    st.rx += SIZE.overhead + packetSize(msg.inner);
    if (!peer.allowedIps.some((c) => inCidr(c, msg.inner.src))) return;
    this.host.receiveInner(this.name, msg.inner);
  }

  // ------------------------------------------------------------ persistent keepalive

  private startTimers(): void {
    const gen = ++this.generation;
    for (const peer of this.config.peers) {
      if (peer.keepalive) this.keepaliveLoop(peer.publicKey, peer.keepalive * MS, gen, 0);
    }
  }

  private keepaliveLoop(key: string, every: number, gen: number, delay: number): void {
    this.host.schedule(delay, () => {
      if (gen !== this.generation) return;
      const peer = this.config.peers.find((p) => p.publicKey === key);
      if (!peer?.keepalive) return;
      const st = this.state(key);
      if (this.fresh(st)) this.transmit(st, undefined);
      else this.initiate(peer, st);
      this.keepaliveLoop(key, every, gen, every);
    });
  }
}
