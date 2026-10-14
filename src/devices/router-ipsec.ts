/**
 * IPsec on the 2911 (crypto maps with ISAKMP): IKE in four messages over UDP 500, ESP tunnels that carry
 * the protected packet, the mirror check on decapsulation and the counters of `show crypto ipsec sa`.
 * The first interesting packet is dropped while IKE comes up, as on real IOS.
 */
import type { Router } from './router.ts';
import type { IpPacket, IsakmpMessage, QuickModeOffer } from '../net/packets.ts';
import { formatIp } from '../core/ip.ts';
import { keyFor } from '../ios/crypto-config.ts';
import type { CryptoMapEntry } from '../ios/crypto-config.ts';
import { aclPacketMatch } from '../ios/acl.ts';
import {
  chooseProposal, entryReady, inNet, isVpnControl, ISAKMP_PORT, offeredProposals, proxiesOf, pskProof,
  randomCookie, randomSpi, sameNet, sameTransforms,
} from './router-ike.ts';
import type { ProxyPair } from './router-ike.ts';

export type IsakmpState = 'MM_NO_STATE' | 'MM_KEY_EXCH' | 'QM_IDLE';

export interface IsakmpSa {
  readonly dst: number;
  readonly src: number;
  readonly state: IsakmpState;
  readonly connId: number;
}

export interface IpsecSa {
  readonly map: string;
  readonly seq: number;
  readonly iface: string;
  readonly local: number;
  readonly peer: number;
  readonly proxies: ProxyPair;
  readonly transforms: readonly string[];
  readonly mode: 'tunnel' | 'transport';
  readonly inSpi: number;
  readonly outSpi: number;
  readonly connIn: number;
}

export interface SaCounters {
  encaps: number;
  decaps: number;
  sendErrors: number;
  recvErrors: number;
}

interface Pending {
  readonly ispi: string;
  readonly entry: CryptoMapEntry & { peer: number; transformSet: string; acl: string };
  readonly iface: string;
  readonly local: number;
  readonly nonce: string;
  readonly offer?: QuickModeOffer;
  readonly started: number;
}

interface Responding {
  readonly iface: string;
  readonly local: number;
  readonly peer: number;
  readonly inonce: string;
  readonly rnonce: string;
}

const IKE_RETRY_MS = 10_000;
const FIRST_CONN_ID = 1001;
const FIRST_SA_CONN = 2001;
const MAX_SAS = 64;

const saKey = (map: string, seq: number, peer: number): string => `${map}|${seq}|${formatIp(peer)}`;

/** The same packet in the other direction (addresses and ports swapped), to test it against our ACL. */
function mirror(p: IpPacket): IpPacket {
  const swap = <T extends { sport: number; dport: number }>(l4: T | undefined): T | undefined => (l4 ? { ...l4, sport: l4.dport, dport: l4.sport } : undefined);
  return { ...p, src: p.dst, dst: p.src, tcp: swap(p.tcp), udp: swap(p.udp) };
}

export class IpsecEngine {
  private readonly r: Router;
  private readonly pending = new Map<string, Pending>();
  private readonly responding = new Map<string, Responding>();
  private isakmp: IsakmpSa[] = [];
  private sas: IpsecSa[] = [];
  readonly counters = new Map<string, SaCounters>();
  private nextConn = FIRST_CONN_ID;
  private nextSaConn = FIRST_SA_CONN;

  constructor(router: Router) {
    this.r = router;
  }

  isakmpSas(): readonly IsakmpSa[] {
    return this.isakmp;
  }

  ipsecSas(): readonly IpsecSa[] {
    return this.sas;
  }

  /** The SA currently used to send for a map entry and peer. */
  current(map: string, seq: number, peer: number): IpsecSa | undefined {
    return [...this.sas].reverse().find((s) => s.map === map && s.seq === seq && s.peer === peer);
  }

  countersFor(map: string, seq: number, peer: number): SaCounters {
    const key = saKey(map, seq, peer);
    const found = this.counters.get(key);
    if (found) return found;
    const fresh = { encaps: 0, decaps: 0, sendErrors: 0, recvErrors: 0 };
    this.counters.set(key, fresh);
    return fresh;
  }

  /** clear crypto isakmp / clear crypto sa. */
  clear(what: 'isakmp' | 'sa' | 'all'): void {
    if (what !== 'sa') this.isakmp = [];
    if (what !== 'isakmp') {
      this.sas = [];
      this.counters.clear();
    }
    this.pending.clear();
    this.responding.clear();
  }

  // ------------------------------------------------------------ outbound

  private entriesOn(iface: string): CryptoMapEntry[] {
    const map = this.r.iface(iface)?.cryptoMap;
    return map ? this.r.crypto.maps.filter((e) => e.map === map) : [];
  }

  private localAddr(iface: string): number {
    return this.r.plane.l3Iface(iface)?.addrs[0]?.ip ?? 0;
  }

  /**
   * A packet leaving `iface`: wrapped in ESP when a crypto map entry permits it (null = sent here or
   * dropped while IKE negotiates); anything else goes out unchanged.
   */
  outbound(iface: string, p: IpPacket): IpPacket | null {
    if (isVpnControl(p)) return p;
    for (const entry of this.entriesOn(iface)) {
      if (!entryReady(entry)) continue;
      const hit = aclPacketMatch(this.r.acls.get(entry.acl), p);
      // A deny only means «not this entry»: IOS carries on with the next sequence number.
      if (hit?.action !== 'permit') continue;
      const sa = this.current(entry.map, entry.seq, entry.peer);
      if (sa) return this.encapsulate(sa, p);
      this.countersFor(entry.map, entry.seq, entry.peer).sendErrors += 1;
      this.initiate(entry, iface);
      return null;
    }
    return p;
  }

  private encapsulate(sa: IpsecSa, inner: IpPacket): null {
    const c = this.countersFor(sa.map, sa.seq, sa.peer);
    c.encaps += 1;
    this.r.plane.stack.send({ src: sa.local, dst: sa.peer, ttl: this.r.plane.ttl, protocol: 'esp', esp: { spi: sa.outSpi, seq: c.encaps, inner } });
    return null;
  }

  // ------------------------------------------------------------ inbound

  /**
   * Prerouting on a crypto-map interface: ESP for us is decapsulated (the inner packet carries on);
   * cleartext that an SA should have protected is dropped.
   */
  inbound(iface: string, p: IpPacket): IpPacket | null {
    if (p.protocol === 'esp' && p.esp && this.r.plane.stack.isMine(p.dst)) return this.decapsulate(p);
    if (isVpnControl(p) || !this.r.iface(iface)?.cryptoMap) return p;
    const sa = this.sas.find((s) => s.iface === iface && inNet(s.proxies.remote, p.src) && inNet(s.proxies.local, p.dst));
    if (!sa) return p;
    this.countersFor(sa.map, sa.seq, sa.peer).recvErrors += 1;
    this.r.log(`%CRYPTO-4-RECVD_PKT_NOT_IPSEC: Rec'd packet not an IPSEC packet. (ip) vrf/dest_addr= (none)/${formatIp(p.dst)}, src_addr= ${formatIp(p.src)}, prot= ${protoNumber(p)}`);
    return null;
  }

  private decapsulate(p: IpPacket): IpPacket | null {
    const esp = p.esp;
    if (!esp) return null;
    const sa = this.sas.find((s) => s.inSpi === esp.spi && s.peer === p.src);
    if (!sa) {
      this.r.log(`%CRYPTO-4-RECVD_PKT_INV_SPI: decaps: rec'd IPSEC packet has invalid spi for destaddr=${formatIp(p.dst)}, prot=50, spi=0x${hex(esp.spi)}(${esp.spi}), srcaddr=${formatIp(p.src)}`);
      return null;
    }
    const c = this.countersFor(sa.map, sa.seq, sa.peer);
    const inner = esp.inner;
    if (!this.identityAllowed(sa, inner)) {
      c.recvErrors += 1;
      this.r.log(`%CRYPTO-4-RECVD_PKT_INV_IDENTITY_ACL: ipsec check access: identity not allowed by ACL policy. Packet src_addr=${formatIp(inner.src)}, dest_addr=${formatIp(inner.dst)}`);
      return null;
    }
    c.decaps += 1;
    return inner;
  }

  /** The inner packet, seen from our side, is permitted by the crypto ACL (any of its permit lines). */
  private identityAllowed(sa: IpsecSa, inner: IpPacket): boolean {
    const entry = this.r.crypto.maps.find((e) => e.map === sa.map && e.seq === sa.seq);
    const acl = entry?.acl === undefined ? undefined : this.r.acls.get(entry.acl);
    if (!acl) return inNet(sa.proxies.remote, inner.src) && inNet(sa.proxies.local, inner.dst);
    return aclPacketMatch(acl, mirror(inner))?.action === 'permit';
  }

  // ------------------------------------------------------------ IKE

  private sendIke(src: number, dst: number, msg: IsakmpMessage): void {
    this.r.plane.stack.send({ src, dst, ttl: this.r.plane.ttl, protocol: 'udp', udp: { sport: ISAKMP_PORT, dport: ISAKMP_PORT, isakmp: msg } });
  }

  private setIsakmp(dst: number, src: number, state: IsakmpState): void {
    const old = this.isakmp.find((s) => s.dst === dst && s.src === src);
    const connId = old?.connId ?? this.nextConn++;
    this.isakmp = [...this.isakmp.filter((s) => s !== old), { dst, src, state, connId }];
  }

  private initiate(entry: Pending['entry'], iface: string): void {
    const now = this.r.clock.now();
    const busy = [...this.pending.values()].some((x) => x.entry.peer === entry.peer && now - x.started < IKE_RETRY_MS);
    if (busy) return;
    const local = this.localAddr(iface);
    const ispi = randomCookie();
    const nonce = randomCookie();
    this.pending.set(ispi, { ispi, entry, iface, local, nonce, started: now });
    this.setIsakmp(entry.peer, local, 'MM_NO_STATE');
    this.sendIke(local, entry.peer, { kind: 'mm1', ispi, policies: offeredProposals(this.r.crypto), nonce });
  }

  /** ISAKMP datagram delivered to the router (`deliver` on UDP 500). */
  onIsakmp(iface: string, p: IpPacket): void {
    const msg = p.udp?.isakmp;
    if (!msg) return;
    if (msg.kind === 'mm1') this.onMm1(iface, p, msg);
    else if (msg.kind === 'mm2') this.onMm2(p, msg);
    else if (msg.kind === 'mm3') this.onMm3(p, msg);
    else if (msg.kind === 'qm2') this.onQm2(p, msg);
    else this.onNotify(p, msg);
  }

  private modeFailure(mode: 'Main' | 'Quick', peer: number): void {
    this.r.log(`%CRYPTO-6-IKMP_MODE_FAILURE: Processing of ${mode} mode failed with peer at ${formatIp(peer)}`);
  }

  private onMm1(iface: string, p: IpPacket, msg: Extract<IsakmpMessage, { kind: 'mm1' }>): void {
    if (!this.r.iface(iface)?.cryptoMap) return;
    const local = this.localAddr(iface);
    const chosen = chooseProposal(this.r.crypto, msg.policies);
    const psk = keyFor(this.r.crypto, p.src);
    if (!chosen) {
      this.modeFailure('Main', p.src);
      this.sendIke(local, p.src, { kind: 'notify', ispi: msg.ispi, reason: 'no-proposal' });
      return;
    }
    if (psk === undefined) {
      this.sendIke(local, p.src, { kind: 'notify', ispi: msg.ispi, reason: 'auth' });
      return;
    }
    const rnonce = randomCookie();
    this.responding.set(msg.ispi, { iface, local, peer: p.src, inonce: msg.nonce, rnonce });
    this.setIsakmp(local, p.src, 'MM_KEY_EXCH');
    this.sendIke(local, p.src, { kind: 'mm2', ispi: msg.ispi, rspi: randomCookie(), policy: chosen, nonce: rnonce, auth: pskProof(psk, msg.nonce, rnonce, 'R') });
  }

  private onMm2(p: IpPacket, msg: Extract<IsakmpMessage, { kind: 'mm2' }>): void {
    const pend = this.pending.get(msg.ispi);
    if (!pend || pend.entry.peer !== p.src) return;
    const psk = keyFor(this.r.crypto, p.src);
    if (psk === undefined || pskProof(psk, pend.nonce, msg.nonce, 'R') !== msg.auth) {
      this.pending.delete(msg.ispi);
      this.r.log(`%CRYPTO-4-IKMP_BAD_MESSAGE: IKE message from ${formatIp(p.src)} failed its sanity check or is malformed`);
      return;
    }
    const proxies = proxiesOf(this.r.acls.get(pend.entry.acl));
    const ts = this.r.crypto.transformSets.find((t) => t.name === pend.entry.transformSet);
    if (!proxies || !ts) return;
    this.setIsakmp(p.src, pend.local, 'QM_IDLE');
    const offer: QuickModeOffer = { local: proxies.local, remote: proxies.remote, transforms: ts.transforms, spi: randomSpi() };
    this.pending.set(msg.ispi, { ...pend, offer });
    this.sendIke(pend.local, p.src, { kind: 'mm3', ispi: msg.ispi, rspi: msg.rspi, auth: pskProof(psk, pend.nonce, msg.nonce, 'I'), qm: offer });
  }

  private onMm3(p: IpPacket, msg: Extract<IsakmpMessage, { kind: 'mm3' }>): void {
    const resp = this.responding.get(msg.ispi);
    if (!resp || resp.peer !== p.src) return;
    this.responding.delete(msg.ispi);
    const psk = keyFor(this.r.crypto, p.src) ?? '';
    if (pskProof(psk, resp.inonce, resp.rnonce, 'I') !== msg.auth) {
      this.r.log(`%CRYPTO-4-IKMP_BAD_MESSAGE: IKE message from ${formatIp(p.src)} failed its sanity check or is malformed`);
      this.sendIke(resp.local, p.src, { kind: 'notify', ispi: msg.ispi, reason: 'auth' });
      return;
    }
    this.setIsakmp(resp.local, p.src, 'QM_IDLE');
    const match = this.matchOffer(resp.iface, p.src, msg.qm);
    if (!match) {
      this.modeFailure('Quick', p.src);
      this.sendIke(resp.local, p.src, { kind: 'notify', ispi: msg.ispi, reason: 'qm' });
      return;
    }
    const inSpi = randomSpi();
    this.addSa({ ...match, iface: resp.iface, local: resp.local, peer: p.src, inSpi, outSpi: msg.qm.spi });
    this.sendIke(resp.local, p.src, { kind: 'qm2', ispi: msg.ispi, spi: inSpi, transforms: msg.qm.transforms });
  }

  /** The responder's entry whose ACL mirrors the offer and whose transform set matches. */
  private matchOffer(iface: string, peer: number, qm: QuickModeOffer): Pick<IpsecSa, 'map' | 'seq' | 'proxies' | 'transforms' | 'mode'> | undefined {
    for (const e of this.entriesOn(iface)) {
      if (!entryReady(e) || e.peer !== peer) continue;
      const proxies = proxiesOf(this.r.acls.get(e.acl));
      const ts = this.r.crypto.transformSets.find((t) => t.name === e.transformSet);
      if (!proxies || !ts || !sameTransforms(ts.transforms, qm.transforms)) continue;
      if (sameNet(proxies.local, qm.remote) && sameNet(proxies.remote, qm.local)) return { map: e.map, seq: e.seq, proxies, transforms: ts.transforms, mode: ts.mode };
    }
    return undefined;
  }

  private onQm2(p: IpPacket, msg: Extract<IsakmpMessage, { kind: 'qm2' }>): void {
    const pend = this.pending.get(msg.ispi);
    if (!pend?.offer || pend.entry.peer !== p.src) return;
    this.pending.delete(msg.ispi);
    const ts = this.r.crypto.transformSets.find((t) => t.name === pend.entry.transformSet);
    const proxies = { local: pend.offer.local, remote: pend.offer.remote };
    this.addSa({ map: pend.entry.map, seq: pend.entry.seq, iface: pend.iface, local: pend.local, peer: p.src, proxies, transforms: pend.offer.transforms, mode: ts?.mode ?? 'tunnel', inSpi: pend.offer.spi, outSpi: msg.spi });
  }

  private onNotify(p: IpPacket, msg: Extract<IsakmpMessage, { kind: 'notify' }>): void {
    const pend = this.pending.get(msg.ispi);
    if (!pend || pend.entry.peer !== p.src) return;
    this.pending.delete(msg.ispi);
    if (msg.reason === 'auth') this.r.log(`%CRYPTO-4-IKMP_BAD_MESSAGE: IKE message from ${formatIp(p.src)} failed its sanity check or is malformed`);
    else this.modeFailure(msg.reason === 'qm' ? 'Quick' : 'Main', p.src);
  }

  private addSa(sa: Omit<IpsecSa, 'connIn'>): void {
    const connIn = this.nextSaConn;
    this.nextSaConn += 2;
    this.sas = [...this.sas.slice(-(MAX_SAS - 1)), { ...sa, connIn }];
  }
}

export function hex(n: number): string {
  return n.toString(16).toUpperCase();
}

function protoNumber(p: IpPacket): number {
  if (p.protocol === 'icmp') return 1;
  if (p.protocol === 'tcp') return 6;
  return p.protocol === 'udp' ? 17 : 50;
}
