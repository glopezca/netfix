/** show crypto isakmp sa | isakmp policy | ipsec sa | map, and clear crypto (IOS 15 / Packet Tracer format). */
import type { CommandDef } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import type { IpsecSa } from '../../devices/router-ipsec.ts';
import { hex } from '../../devices/router-ipsec.ts';
import { entryReady, proxiesOf } from '../../devices/router-ike.ts';
import type { ProxyNet } from '../../devices/router-ike.ts';
import type { CryptoMapEntry, IsakmpPolicy } from '../crypto-config.ts';
import { defaultPolicy } from '../crypto-config.ts';
import { formatIp, formatMask } from '../../core/ip.ts';
import { showAccessLists } from '../acl.ts';

type Def = CommandDef<Cli<Router>>;

const ENCRYPTION_TEXT: Readonly<Record<string, string>> = {
  des: 'DES - Data Encryption Standard (56 bit keys).',
  '3des': 'Three key triple DES',
  aes: 'AES - Advanced Encryption Standard (128 bit keys).',
  'aes 192': 'AES - Advanced Encryption Standard (192 bit keys).',
  'aes 256': 'AES - Advanced Encryption Standard (256 bit keys).',
};
const HASH_TEXT: Readonly<Record<string, string>> = { sha: 'Secure Hash Standard', md5: 'Message Digest 5' };
const AUTH_TEXT: Readonly<Record<string, string>> = { 'pre-share': 'Pre-Shared Key', 'rsa-sig': 'Rivest-Shamir-Adleman Signature', 'rsa-encr': 'Rivest-Shamir-Adleman Encryption' };
const GROUP_TEXT: Readonly<Record<number, string>> = { 1: '#1 (768 bit)', 2: '#2 (1024 bit)', 5: '#5 (1536 bit)' };
const SA_LIFETIME = '(4525504/3593)';

function policyBlock(title: string, p: IsakmpPolicy): string[] {
  return [
    title,
    `\tencryption algorithm:\t${ENCRYPTION_TEXT[p.encryption] ?? p.encryption}`,
    `\thash algorithm:\t\t${HASH_TEXT[p.hash] ?? p.hash}`,
    `\tauthentication method:\t${AUTH_TEXT[p.auth] ?? p.auth}`,
    `\tDiffie-Hellman group:\t${GROUP_TEXT[p.group] ?? `#${p.group}`}`,
    `\tlifetime:\t\t${p.lifetime} seconds, no volume limit`,
  ];
}

export function showIsakmpPolicy(r: Router): string[] {
  return ['', 'Global IKE policy', ...r.crypto.policies.flatMap((p) => policyBlock(`Protection suite of priority ${p.priority}`, p)), ...policyBlock('Default protection suite', defaultPolicy(0))];
}

export function showIsakmpSa(r: Router): string[] {
  const rows = r.ipsec.isakmpSas().map((s) => `${formatIp(s.dst).padEnd(16)}${formatIp(s.src).padEnd(16)}${s.state.padEnd(15)}${String(s.connId).padStart(7)} ACTIVE`);
  return ['IPv4 Crypto ISAKMP SA', 'dst             src             state          conn-id status', ...rows, '', 'IPv6 Crypto ISAKMP SA', ''];
}

const ident = (n: ProxyNet): string => `(${formatIp(n.ip)}/${formatMask(n.prefix)}/0/0)`;

function espSas(sa: IpsecSa | undefined, spi: number, conn: number): string[] {
  if (!sa) return [];
  return [
    `      spi: 0x${hex(spi)}(${spi})`,
    `        transform: ${sa.transforms.join(' ')} ,`,
    `        in use settings ={${sa.mode === 'tunnel' ? 'Tunnel' : 'Transport'}, }`,
    `        conn id: ${conn}, flow_id: FPGA:1, sibling_flags 80000046, crypto map: ${sa.map}`,
    `        sa timing: remaining key lifetime (k/sec): ${SA_LIFETIME}`,
    '        IV size: 16 bytes',
    '        replay detection support: Y',
    '        Status: ACTIVE',
  ];
}

function entryBlock(r: Router, iface: string, e: CryptoMapEntry & { peer: number; acl: string }): string[] {
  const sa = r.ipsec.current(e.map, e.seq, e.peer);
  const proxies = sa?.proxies ?? proxiesOf(r.acls.get(e.acl)) ?? { local: { ip: 0, prefix: 0 }, remote: { ip: 0, prefix: 0 } };
  const c = r.ipsec.countersFor(e.map, e.seq, e.peer);
  const local = formatIp(r.plane.l3Iface(iface)?.addrs[0]?.ip ?? 0);
  return [
    '', `   protected vrf: (none)`,
    `   local  ident (addr/mask/prot/port): ${ident(proxies.local)}`,
    `   remote ident (addr/mask/prot/port): ${ident(proxies.remote)}`,
    `   current_peer ${formatIp(e.peer)} port 500`,
    '    PERMIT, flags={origin_is_acl,}',
    `   #pkts encaps: ${c.encaps}, #pkts encrypt: ${c.encaps}, #pkts digest: ${c.encaps}`,
    `   #pkts decaps: ${c.decaps}, #pkts decrypt: ${c.decaps}, #pkts verify: ${c.decaps}`,
    '   #pkts compressed: 0, #pkts decompressed: 0',
    '   #pkts not compressed: 0, #pkts compr. failed: 0',
    '   #pkts not decompressed: 0, #pkts decompress failed: 0',
    `   #send errors ${c.sendErrors}, #recv errors ${c.recvErrors}`,
    '',
    `     local crypto endpt.: ${local}, remote crypto endpt.:${formatIp(e.peer)}`,
    `     path mtu 1500, ip mtu 1500, ip mtu idb ${iface}`,
    `     current outbound spi: 0x${hex(sa?.outSpi ?? 0)}(${sa?.outSpi ?? 0})`,
    `     current inbound spi : 0x${hex(sa?.inSpi ?? 0)}(${sa?.inSpi ?? 0})`,
    '', '     inbound esp sas:', ...espSas(sa, sa?.inSpi ?? 0, sa?.connIn ?? 0),
    '', '     inbound ah sas:', '', '     inbound pcp sas:',
    '', '     outbound esp sas:', ...espSas(sa, sa?.outSpi ?? 0, (sa?.connIn ?? 0) + 1),
    '', '     outbound ah sas:', '', '     outbound pcp sas:',
  ];
}

export function showIpsecSa(r: Router): string[] {
  const out: string[] = [];
  for (const iface of r.sortedIfaceNames()) {
    const map = r.iface(iface)?.cryptoMap;
    if (!map) continue;
    const local = formatIp(r.plane.l3Iface(iface)?.addrs[0]?.ip ?? 0);
    out.push('', `interface: ${iface}`, `    Crypto map tag: ${map}, local addr ${local}`);
    for (const e of r.crypto.maps.filter((x) => x.map === map)) if (entryReady(e)) out.push(...entryBlock(r, iface, e));
  }
  return out.length ? out : ['No SAs found'];
}

export function showCryptoMap(r: Router): string[] {
  return r.crypto.maps.flatMap((e) => {
    const acl = e.acl ? showAccessLists(new Map([[e.acl, r.acls.get(e.acl) ?? []]]), new Map(), r.extendedAcls).map((l) => `\t${l.replace(/ \(\d+ match\(es\)\)$/, '')}`) : [];
    const ifaces = r.sortedIfaceNames().filter((n) => r.iface(n)?.cryptoMap === e.map);
    return [
      `Crypto Map ${e.map} ${e.seq} ipsec-isakmp`,
      ...(e.peer !== undefined ? [`\tPeer = ${formatIp(e.peer)}`] : []),
      ...acl,
      ...(e.peer !== undefined ? [`\tCurrent peer: ${formatIp(e.peer)}`] : []),
      '\tSecurity association lifetime: 4608000 kilobytes/3600 seconds',
      `\tPFS (Y/N): ${e.pfs ? 'Y' : 'N'}`,
      '\tTransform sets={',
      ...(e.transformSet ? [`\t\t${e.transformSet},`] : []),
      '\t}',
      `\tInterfaces using crypto map ${e.map}:`,
      ...ifaces.map((n) => `\t\t${n}`),
      '',
    ];
  });
}

export const CRYPTO_EXEC: readonly Def[] = [
  { syntax: 'show crypto isakmp sa', run: (cli) => cli.out(...showIsakmpSa(cli.device)) },
  { syntax: 'show crypto isakmp policy', run: (cli) => cli.out(...showIsakmpPolicy(cli.device)) },
  { syntax: 'show crypto ipsec sa', run: (cli) => cli.out(...showIpsecSa(cli.device)) },
  { syntax: 'show crypto map', run: (cli) => cli.out(...showCryptoMap(cli.device)) },
  { syntax: 'clear crypto isakmp', run: (cli) => cli.device.ipsec.clear('isakmp') },
  { syntax: 'clear crypto sa', run: (cli) => cli.device.ipsec.clear('sa') },
];
