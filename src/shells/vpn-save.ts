/**
 * What the Services → VPN panel and the web admin do with WireGuard: they edit /etc/wireguard/wg0.conf
 * (keeping wg-quick's hooks and DNS), apply it (restart if it was running) and switch
 * wg-quick@wg0.service on/off together with its start at boot.
 */
import type { Host } from '../devices/host.ts';
import { formatIp } from '../core/ip.ts';
import { cidrText, parseCidr, parseEndpoint, parseWgConf } from '../net/wg-config.ts';
import type { WgQuickConfig } from '../net/wg-config.ts';
import { decodeKey, genKey, pubKey } from '../core/x25519.ts';
import { hostSystem } from './host-system.ts';
import { createShell } from './factory.ts';
import { wgUnitEnabled } from './wg-unit.ts';
import { ago, bytes } from './wg-format.ts';

export const VPN_IFACE = 'wg0';
export const VPN_CONF = `/etc/wireguard/${VPN_IFACE}.conf`;
const MAX_FIELD = 200;

export interface VpnPeerForm {
  readonly publicKey: string;
  readonly allowedIps: string;
  readonly endpoint: string;
  readonly keepalive: string;
}

export interface VpnForm {
  readonly privateKey: string;
  readonly address: string;
  readonly listenPort: string;
  readonly peers: readonly VpnPeerForm[];
}

export interface VpnPeerStatus {
  readonly publicKey: string;
  readonly endpoint?: string;
  readonly handshake?: string;
  readonly transfer?: string;
}

export interface VpnStatus {
  readonly active: boolean;
  readonly enabled: boolean;
  readonly form: VpnForm;
  readonly publicKey?: string;
  /** The file exists but wg-quick cannot read it. */
  readonly error?: string;
  readonly peers: readonly VpnPeerStatus[];
}

export const EMPTY_VPN: VpnForm = { privateKey: '', address: '10.10.0.1/24', listenPort: '51820', peers: [] };

function readConf(host: Host): string | null {
  const fs = hostSystem(host).fs;
  return fs.tryLookup(VPN_CONF)?.kind === 'file' ? fs.readFile(VPN_CONF) : null;
}

function formOf(c: WgQuickConfig): VpnForm {
  return {
    privateKey: c.wg.privateKey ?? '',
    address: c.addresses.map(cidrText).join(', '),
    listenPort: String(c.wg.listenPort ?? ''),
    peers: c.wg.peers.map((p) => ({ publicKey: p.publicKey, allowedIps: p.allowedIps.map(cidrText).join(', '), endpoint: p.endpoint ? `${formatIp(p.endpoint.ip)}:${p.endpoint.port}` : '', keepalive: p.keepalive ? String(p.keepalive) : '' })),
  };
}

export function vpnStatus(host: Host): VpnStatus {
  const text = readConf(host);
  const parsed = text === null ? null : parseWgConf(text);
  const link = host.wgLinks()?.get(VPN_IFACE);
  const now = host.clock.now();
  const peers = link ? link.config.peers.map((p) => {
    const st = link.peers.get(p.publicKey);
    const ep = st?.endpoint;
    return { publicKey: p.publicKey, endpoint: ep ? `${formatIp(ep.ip)}:${ep.port}` : undefined, handshake: st?.lastHandshake ? ago(now, st.lastHandshake) : undefined, transfer: st && (st.rx || st.tx) ? `${bytes(st.rx)} ↓ / ${bytes(st.tx)} ↑` : undefined };
  }) : [];
  const form = parsed && typeof parsed !== 'string' ? formOf(parsed) : EMPTY_VPN;
  return {
    active: link !== undefined,
    enabled: wgUnitEnabled(hostSystem(host).fs, VPN_IFACE),
    form,
    publicKey: pubKey(form.privateKey) ?? undefined,
    error: typeof parsed === 'string' ? parsed : undefined,
    peers,
  };
}

const clean = (v: string): string => v.replace(/[\r\n#]/g, '').trim().slice(0, MAX_FIELD);

function peerLines(p: VpnPeerForm, i: number): string[] | string {
  const n = i + 1;
  if (!decodeKey(clean(p.publicKey))) return `peer ${n}: public key`;
  const ips = clean(p.allowedIps).split(',').map((x) => x.trim()).filter(Boolean);
  if (!ips.length || ips.some((x) => !parseCidr(x))) return `peer ${n}: AllowedIPs`;
  if (clean(p.endpoint) && !parseEndpoint(clean(p.endpoint))) return `peer ${n}: Endpoint`;
  const ka = clean(p.keepalive);
  if (ka && !(/^\d+$/.test(ka) && Number(ka) <= 65535)) return `peer ${n}: PersistentKeepalive`;
  return ['', '[Peer]', `PublicKey = ${clean(p.publicKey)}`, `AllowedIPs = ${ips.join(', ')}`, ...(clean(p.endpoint) ? [`Endpoint = ${clean(p.endpoint)}`] : []), ...(ka && ka !== '0' ? [`PersistentKeepalive = ${ka}`] : [])];
}

/** The wg0.conf text of a form (hooks, DNS and MTU of the current file are kept); a string error otherwise. */
export function vpnFileText(form: VpnForm, current: WgQuickConfig | null): { text: string } | { error: string } {
  if (!decodeKey(clean(form.privateKey))) return { error: 'PrivateKey' };
  const addrs = clean(form.address).split(',').map((x) => x.trim()).filter(Boolean);
  if (!addrs.length || addrs.some((a) => !parseCidr(a) || !a.includes('/'))) return { error: 'Address' };
  const port = clean(form.listenPort);
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) return { error: 'ListenPort' };
  const peers = form.peers.map(peerLines);
  const bad = peers.find((p): p is string => typeof p === 'string');
  if (bad) return { error: bad };
  const h = current?.hooks;
  const keep = [
    ...(current?.dns.length ? [`DNS = ${current.dns.join(', ')}`] : []), ...(current?.mtu ? [`MTU = ${current.mtu}`] : []),
    ...(h?.preUp ?? []).map((x) => `PreUp = ${x}`), ...(h?.postUp ?? []).map((x) => `PostUp = ${x}`),
    ...(h?.preDown ?? []).map((x) => `PreDown = ${x}`), ...(h?.postDown ?? []).map((x) => `PostDown = ${x}`),
  ];
  const head = ['[Interface]', `Address = ${addrs.join(', ')}`, ...(port ? [`ListenPort = ${port}`] : []), `PrivateKey = ${clean(form.privateKey)}`, ...keep];
  return { text: `${[...head, ...peers.flatMap((p) => (typeof p === 'string' ? [] : p))].join('\n')}\n` };
}

const root = (host: Host): ReturnType<typeof createShell> => createShell(host, 'linux', 'root');

/** Writes wg0.conf from the form and restarts the tunnel if it was up; returns an error or null. */
export function saveVpn(host: Host, form: VpnForm): string | null {
  const text = readConf(host);
  const parsed = text === null ? null : parseWgConf(text);
  const built = vpnFileText(form, parsed && typeof parsed !== 'string' ? parsed : null);
  if ('error' in built) return built.error;
  const fs = hostSystem(host).fs;
  fs.writeFile(VPN_CONF, built.text, undefined, false, 0o600);
  fs.chmod(VPN_CONF, 0o600);
  if (!host.wgLinks()?.get(VPN_IFACE)) return null;
  const out = root(host).run(`systemctl restart wg-quick@${VPN_IFACE} 2>&1`);
  host.notifyChange();
  return out.length ? out.join('\n') : null;
}

/** Turns the tunnel on (and on at boot) or off; returns the failure text or null. */
export function setVpnActive(host: Host, on: boolean): string | null {
  const out = root(host).run(`systemctl ${on ? 'enable' : 'disable'} --now wg-quick@${VPN_IFACE} 2>&1`).filter((l) => !/^(Created symlink|Removed)/.test(l));
  host.notifyChange();
  return out.length ? out.join('\n') : null;
}

export const newPrivateKey = genKey;
