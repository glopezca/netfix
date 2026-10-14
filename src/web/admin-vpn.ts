/**
 * "Seguridad → VPN" of the management GUI: the WireGuard tunnel wg0 of the Linux router (on/off,
 * interface, peers and their status). Same code as Services → VPN; the private key is never sent back
 * to the browser (an empty field keeps it).
 */
import type { Server } from '../devices/server.ts';
import { newPrivateKey, saveVpn, setVpnActive, vpnStatus } from '../shells/vpn-save.ts';
import type { VpnForm } from '../shells/vpn-save.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, check, form, row, section, text } from './admin-layout.ts';
import type { Fields, Outcome } from './admin-firewall-actions.ts';

const SAVED: Outcome = { ok: 'Los cambios se han guardado correctamente.' };

function peerRows(server: Server, base: string): Markup {
  const st = vpnStatus(server);
  const live = new Map(st.peers.map((p) => [p.publicKey, p]));
  const rows = st.form.peers.map((p) => h('tr', {},
    h('td', { class: 'web-wrt-mono' }, p.publicKey), h('td', { class: 'web-wrt-mono' }, p.allowedIps), h('td', { class: 'web-wrt-mono' }, live.get(p.publicKey)?.endpoint ?? (p.endpoint || '—')),
    h('td', {}, live.get(p.publicKey)?.handshake ?? 'nunca'), h('td', {}, live.get(p.publicKey)?.transfer ?? '—'),
    h('td', {}, form(base, 'vpn', 'vpn-peer-del', h('input', { type: 'hidden', name: 'key', value: p.publicKey }), h('button', { type: 'submit', class: 'web-wrt-small' }, 'Borrar')))));
  return h('table', { class: 'web-wrt-list' }, h('tr', {}, ...['Clave pública', 'AllowedIPs', 'Endpoint', 'Último handshake', 'Tráfico', ''].map((c) => h('th', {}, c))),
    rows.length ? rows : h('tr', {}, h('td', { colspan: 6 }, 'Sin pares.')));
}

export function vpnPage(server: Server, base: string): Child {
  if (server.kind !== 'linuxrouter') return h('tr', {}, h('td', {}, 'WireGuard solo está en el router Linux.'));
  const st = vpnStatus(server);
  return [
    form(base, 'vpn', 'vpn-service', h('table', {}, section('Túnel wg0', 'wg-quick@wg0: al activarlo también arranca con el equipo. Abre el puerto UDP en el cortafuegos si la cadena input descarta.',
      check('enabled', st.active, 'Activado'), st.error ? h('p', { class: 'web-wrt-error' }, `wg0.conf tiene un error: ${st.error}`) : null)), buttons()),
    form(base, 'vpn', 'vpn-iface', h('table', {}, section('Interfaz', 'Se guarda en /etc/wireguard/wg0.conf (600). Deja la clave privada vacía para conservarla.',
      row('Clave pública', h('code', { class: 'web-wrt-mono' }, st.publicKey ?? '—')),
      row('Clave privada', h('input', { type: 'password', name: 'privateKey', value: '', autocomplete: 'off' })), check('genkey', false, 'Generar claves nuevas'),
      row('Dirección (CIDR)', text('address', st.form.address)), row('Puerto UDP', text('listenPort', st.form.listenPort)))), buttons()),
    section('Pares', 'Cada par: su clave pública, las redes que llegan por él (AllowedIPs) y, si se le puede llamar, su IP:puerto.', peerRows(server, base)),
    form(base, 'vpn', 'vpn-peer-add', h('table', {}, section('Nuevo par', 'Keepalive (25 s) mantiene abierto el NAT cuando el par está detrás de un router con PAT.',
      row('Clave pública', text('publicKey', '')), row('AllowedIPs', text('allowedIps', '', { placeholder: '10.10.0.2/32, 192.168.2.0/24' })),
      row('Endpoint', text('endpoint', '', { placeholder: '203.0.113.2:51820' })), row('Keepalive', text('keepalive', '', { placeholder: '25' })))), buttons()),
  ];
}

function withForm(server: Server, change: (f: VpnForm) => VpnForm): Outcome {
  const err = saveVpn(server, change(vpnStatus(server).form));
  return err ? { error: `Valor no válido: ${err}` } : SAVED;
}

/** Form actions of the VPN page; null when the action is not one of them. */
export function vpnAction(server: Server, f: Fields): Outcome | null {
  if (!(f.get('action') ?? '').startsWith('vpn-')) return null;
  if (server.kind !== 'linuxrouter') return { error: 'WireGuard solo está en el router Linux.' };
  switch (f.get('action')) {
    case 'vpn-service': { const err = setVpnActive(server, f.has('enabled')); return err ? { error: err } : SAVED; }
    case 'vpn-iface': return withForm(server, (cur) => ({
      ...cur,
      privateKey: f.has('genkey') ? newPrivateKey() : (f.get('privateKey') ?? '').trim() || cur.privateKey,
      address: f.get('address') ?? cur.address, listenPort: f.get('listenPort') ?? cur.listenPort,
    }));
    case 'vpn-peer-add': return withForm(server, (cur) => ({ ...cur, peers: [...cur.peers.filter((p) => p.publicKey !== (f.get('publicKey') ?? '').trim()), { publicKey: f.get('publicKey') ?? '', allowedIps: f.get('allowedIps') ?? '', endpoint: f.get('endpoint') ?? '', keepalive: f.get('keepalive') ?? '' }] }));
    case 'vpn-peer-del': return withForm(server, (cur) => ({ ...cur, peers: cur.peers.filter((p) => p.publicKey !== f.get('key')) }));
    default: return { error: 'Acción desconocida.' };
  }
}
