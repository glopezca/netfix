/** Output of `wg show` (interface and peers, human times and sizes) and its per-field variants. */
import type { WgInterface } from '../devices/wireguard.ts';
import type { WgPeerConfig } from '../net/wg-config.ts';
import { cidrText } from '../net/wg-config.ts';
import { formatIp } from '../core/ip.ts';

const KIB = 1024;
const UNITS: readonly (readonly [number, string])[] = [[365 * 86400, 'year'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
const MS = 1000;

/** `1 minute, 5 seconds ago` (wg's ago()). */
export function ago(nowMs: number, thenMs: number): string {
  let left = Math.max(0, Math.floor((nowMs - thenMs) / MS));
  if (left === 0) return 'Now';
  const parts: string[] = [];
  for (const [size, name] of UNITS) {
    const n = Math.floor(left / size);
    left -= n * size;
    if (n) parts.push(`${n} ${name}${n === 1 ? '' : 's'}`);
  }
  return `${parts.join(', ')} ago`;
}

/** `92 B`, `1.24 KiB`… (wg's bytes()). */
export function bytes(n: number): string {
  if (n < KIB) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / KIB;
  let i = 0;
  while (v >= KIB && i < units.length - 1) {
    v /= KIB;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

const endpointText = (link: WgInterface, p: WgPeerConfig): string | undefined => {
  const ep = link.peers.get(p.publicKey)?.endpoint ?? p.endpoint;
  return ep ? `${formatIp(ep.ip)}:${ep.port}` : undefined;
};

function peerBlock(link: WgInterface, p: WgPeerConfig, now: number): string[] {
  const st = link.peers.get(p.publicKey);
  const ep = endpointText(link, p);
  return [
    '',
    `peer: ${p.publicKey}`,
    ...(p.presharedKey ? ['  preshared key: (hidden)'] : []),
    ...(ep ? [`  endpoint: ${ep}`] : []),
    `  allowed ips: ${p.allowedIps.length ? p.allowedIps.map(cidrText).join(', ') : '(none)'}`,
    ...(st?.lastHandshake ? [`  latest handshake: ${ago(now, st.lastHandshake)}`] : []),
    ...(st && (st.rx || st.tx) ? [`  transfer: ${bytes(st.rx)} received, ${bytes(st.tx)} sent`] : []),
    ...(p.keepalive ? [`  persistent keepalive: every ${p.keepalive} second${p.keepalive === 1 ? '' : 's'}`] : []),
  ];
}

export function showLink(link: WgInterface, now: number): string[] {
  const pub = link.publicKey();
  return [
    `interface: ${link.name}`,
    ...(pub ? [`  public key: ${pub}`, '  private key: (hidden)'] : []),
    `  listening port: ${link.listenPort}`,
    ...link.config.peers.flatMap((p) => peerBlock(link, p, now)),
  ];
}

export const SHOW_FIELDS = ['public-key', 'private-key', 'listen-port', 'fwmark', 'peers', 'preshared-keys', 'endpoints', 'allowed-ips', 'latest-handshakes', 'transfer', 'persistent-keepalive', 'dump'] as const;
export type ShowField = (typeof SHOW_FIELDS)[number];

function peerField(link: WgInterface, p: WgPeerConfig, field: ShowField): string {
  const st = link.peers.get(p.publicKey);
  switch (field) {
    case 'preshared-keys': return `${p.publicKey}\t${p.presharedKey ?? '(none)'}`;
    case 'endpoints': return `${p.publicKey}\t${endpointText(link, p) ?? '(none)'}`;
    case 'allowed-ips': return `${p.publicKey}\t${p.allowedIps.length ? p.allowedIps.map(cidrText).join(' ') : '(none)'}`;
    case 'latest-handshakes': return `${p.publicKey}\t${Math.floor((st?.lastHandshake ?? 0) / MS)}`;
    case 'transfer': return `${p.publicKey}\t${st?.rx ?? 0}\t${st?.tx ?? 0}`;
    case 'persistent-keepalive': return `${p.publicKey}\t${p.keepalive ?? 'off'}`;
    case 'dump': return [p.publicKey, p.presharedKey ?? '(none)', endpointText(link, p) ?? '(none)', p.allowedIps.map(cidrText).join(',') || '(none)', Math.floor((st?.lastHandshake ?? 0) / MS), st?.rx ?? 0, st?.tx ?? 0, p.keepalive ?? 'off'].join('\t');
    default: return p.publicKey;
  }
}

/** `wg show IFACE FIELD` lines; `prefix` adds the interface name (wg show all FIELD). */
export function showField(link: WgInterface, field: ShowField, prefix: boolean): string[] {
  const pre = prefix ? `${link.name}\t` : '';
  if (field === 'public-key') return [`${pre}${link.publicKey() ?? '(none)'}`];
  if (field === 'private-key') return [`${pre}${link.config.privateKey ?? '(none)'}`];
  if (field === 'listen-port') return [`${pre}${link.listenPort}`];
  if (field === 'fwmark') return [`${pre}off`];
  const head = field === 'dump' ? [`${pre}${[link.config.privateKey ?? '(none)', link.publicKey() ?? '(none)', link.listenPort, 'off'].join('\t')}`] : [];
  return [...head, ...link.config.peers.map((p) => `${pre}${peerField(link, p, field)}`)];
}
