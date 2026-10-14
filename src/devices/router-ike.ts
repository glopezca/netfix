/**
 * IKE helpers of the 2911: proxy identities from the crypto ACL, ISAKMP policy negotiation and the
 * pre-shared key proof (sha256 over the key and both nonces; the key itself never leaves the router).
 */
import type { IkeProposal, IpPacket } from '../net/packets.ts';
import type { AclEntry } from '../ios/acl.ts';
import type { CryptoConfig, CryptoMapEntry, IsakmpPolicy } from '../ios/crypto-config.ts';
import { defaultPolicy } from '../ios/crypto-config.ts';
import { sha256, toBase64, utf8 } from '../core/sha256.ts';

export interface ProxyNet {
  readonly ip: number;
  readonly prefix: number;
}

export interface ProxyPair {
  readonly local: ProxyNet;
  readonly remote: ProxyNet;
}

export const ISAKMP_PORT = 500;
const ALL_ONES = 0xffffffff;
const MAX_PREFIX = 32;

/** 1-bits of a contiguous wildcard → prefix length (`0.0.0.255` → 24). */
function wildcardPrefix(wildcard: number): number {
  let n = 0;
  for (let m = (~wildcard) >>> 0; m & 0x80000000; m = (m << 1) >>> 0) n++;
  return n;
}

function netOf(ip: number, wildcard: number): ProxyNet {
  const prefix = wildcardPrefix(wildcard);
  const mask = prefix === 0 ? 0 : (ALL_ONES << (MAX_PREFIX - prefix)) >>> 0;
  return { ip: (ip & mask) >>> 0, prefix };
}

/** The proxy identities a crypto map offers: the first `permit` of its access list. */
export function proxiesOf(entries: readonly AclEntry[] | undefined): ProxyPair | undefined {
  const e = entries?.find((x) => x.action === 'permit');
  if (!e) return undefined;
  const remote = e.ext ? netOf(e.ext.dst.ip, e.ext.dst.wildcard) : { ip: 0, prefix: 0 };
  return { local: netOf(e.ip, e.wildcard), remote };
}

export function inNet(net: ProxyNet, ip: number): boolean {
  const mask = net.prefix === 0 ? 0 : (ALL_ONES << (MAX_PREFIX - net.prefix)) >>> 0;
  return ((ip & mask) >>> 0) === net.ip;
}

export function sameNet(a: ProxyNet, b: ProxyNet): boolean {
  return a.ip === b.ip && a.prefix === b.prefix;
}

/** A complete crypto map entry: IOS keeps the others disabled. */
export function entryReady(e: CryptoMapEntry): e is CryptoMapEntry & { peer: number; transformSet: string; acl: string } {
  return e.peer !== undefined && e.transformSet !== undefined && e.acl !== undefined;
}

/** Packets IPsec never wraps again: ESP and IKE themselves. */
export function isVpnControl(p: IpPacket): boolean {
  return p.protocol === 'esp' || p.udp?.dport === ISAKMP_PORT || p.udp?.sport === ISAKMP_PORT;
}

export function proposalOf(p: IsakmpPolicy): IkeProposal {
  return { encryption: p.encryption, hash: p.hash, auth: p.auth, group: p.group };
}

/** What the initiator offers: every configured policy (the IOS default suite when there is none). */
export function offeredProposals(c: CryptoConfig): IkeProposal[] {
  const policies = c.policies.length ? c.policies : [defaultPolicy(65535)];
  return policies.map(proposalOf);
}

/** The responder takes its own policies in priority order and the first offer that matches exactly. */
export function chooseProposal(c: CryptoConfig, offers: readonly IkeProposal[]): IkeProposal | undefined {
  for (const p of c.policies) {
    const mine = proposalOf(p);
    const ok = offers.find((o) => o.encryption === mine.encryption && o.hash === mine.hash && o.auth === mine.auth && o.group === mine.group);
    if (ok && ok.auth === 'pre-share') return ok;
  }
  return undefined;
}

/** Proof of knowledge of the pre-shared key for one exchange and role. */
export function pskProof(psk: string, inonce: string, rnonce: string, role: 'I' | 'R'): string {
  return toBase64(sha256(utf8(`netfix-ike|${psk}|${inonce}|${rnonce}|${role}`)));
}

export function randomU32(): number {
  const out = new Uint32Array(1);
  globalThis.crypto.getRandomValues(out);
  return out[0] ?? 1;
}

export function randomCookie(): string {
  return `${randomU32().toString(16).padStart(8, '0')}${randomU32().toString(16).padStart(8, '0')}`;
}

/** SPIs below 256 are reserved. */
export function randomSpi(): number {
  return (randomU32() | 0x1000) >>> 0;
}

export function sameTransforms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}
