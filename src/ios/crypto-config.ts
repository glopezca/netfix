/**
 * IPsec configuration of the 2911 (IOS 15.1): ISAKMP policies, pre-shared keys, transform sets and
 * crypto maps, as immutable records, and their running-config lines (defaults are not printed, as in IOS).
 */
import { formatIp, formatMask } from '../core/ip.ts';

export interface IsakmpPolicy {
  readonly priority: number;
  readonly encryption: string;
  readonly hash: string;
  readonly auth: 'pre-share' | 'rsa-sig' | 'rsa-encr';
  readonly group: number;
  readonly lifetime: number;
}

export interface IsakmpKey {
  readonly key: string;
  readonly address: number;
  readonly mask: number;
}

export interface TransformSet {
  readonly name: string;
  readonly transforms: readonly string[];
  readonly mode: 'tunnel' | 'transport';
}

export interface CryptoMapEntry {
  readonly map: string;
  readonly seq: number;
  readonly peer?: number;
  readonly transformSet?: string;
  readonly acl?: string;
  readonly pfs?: string;
}

export interface CryptoConfig {
  readonly policies: readonly IsakmpPolicy[];
  readonly keys: readonly IsakmpKey[];
  readonly transformSets: readonly TransformSet[];
  readonly maps: readonly CryptoMapEntry[];
}

export const EMPTY_CRYPTO: CryptoConfig = { policies: [], keys: [], transformSets: [], maps: [] };

/** IOS defaults of a new policy: des, sha, rsa-sig, group 1, one day. */
export function defaultPolicy(priority: number): IsakmpPolicy {
  return { priority, encryption: 'des', hash: 'sha', auth: 'rsa-sig', group: 1, lifetime: 86400 };
}

export const ESP_ENCRYPTION = ['esp-aes', 'esp-aes 128', 'esp-aes 192', 'esp-aes 256', 'esp-des', 'esp-3des', 'esp-null', 'esp-seal'] as const;
export const ESP_AUTH = ['esp-sha-hmac', 'esp-md5-hmac', 'esp-sha256-hmac'] as const;

export function withPolicy(c: CryptoConfig, p: IsakmpPolicy): CryptoConfig {
  return { ...c, policies: [...c.policies.filter((x) => x.priority !== p.priority), p].sort((a, b) => a.priority - b.priority) };
}

export function withMapEntry(c: CryptoConfig, e: CryptoMapEntry): CryptoConfig {
  return { ...c, maps: [...c.maps.filter((x) => !(x.map === e.map && x.seq === e.seq)), e].sort((a, b) => a.map.localeCompare(b.map) || a.seq - b.seq) };
}

/** Pre-shared key for a peer: the most specific `crypto isakmp key … address A [mask]`. */
export function keyFor(c: CryptoConfig, peer: number): string | undefined {
  return [...c.keys].filter((k) => ((peer & k.mask) >>> 0) === ((k.address & k.mask) >>> 0)).sort((a, b) => b.mask - a.mask)[0]?.key;
}

function policyLines(p: IsakmpPolicy): string[] {
  const d = defaultPolicy(p.priority);
  return [
    `crypto isakmp policy ${p.priority}`,
    ...(p.encryption !== d.encryption ? [` encr ${p.encryption}`] : []),
    ...(p.hash !== d.hash ? [` hash ${p.hash}`] : []),
    ...(p.auth !== d.auth ? [` authentication ${p.auth}`] : []),
    ...(p.group !== d.group ? [` group ${p.group}`] : []),
    ...(p.lifetime !== d.lifetime ? [` lifetime ${p.lifetime}`] : []),
  ];
}

/** The `crypto …` block of the running configuration. */
export function cryptoConfigLines(c: CryptoConfig): string[] {
  if (!c.policies.length && !c.keys.length && !c.transformSets.length && !c.maps.length) return [];
  const keys = c.keys.map((k) => `crypto isakmp key ${k.key} address ${formatIp(k.address)}${k.mask !== 0xffffffff ? ` ${formatMask(maskPrefix(k.mask))}` : ''}`);
  const sets = c.transformSets.map((t) => [`crypto ipsec transform-set ${t.name} ${t.transforms.join(' ')}`, ...(t.mode === 'transport' ? [' mode transport'] : [])]).flat();
  const maps = c.maps.flatMap((m) => [
    `crypto map ${m.map} ${m.seq} ipsec-isakmp `,
    ...(m.peer !== undefined ? [` set peer ${formatIp(m.peer)}`] : []),
    ...(m.transformSet ? [` set transform-set ${m.transformSet} `] : []),
    ...(m.pfs ? [` set pfs ${m.pfs}`] : []),
    ...(m.acl ? [` match address ${m.acl}`] : []),
    '!',
  ]);
  return [...c.policies.flatMap(policyLines), ...keys, '!', '!', ...sets, '!', ...maps];
}

function maskPrefix(mask: number): number {
  let n = 0;
  for (let m = mask >>> 0; m & 0x80000000; m = (m << 1) >>> 0) n++;
  return n;
}
