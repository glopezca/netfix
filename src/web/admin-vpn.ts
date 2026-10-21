/**
 * "Seguridad → VPN" of the management GUI: the WireGuard tunnel wg0 of the Linux router (on/off,
 * interface, peers and their status). Same code as Services → VPN; the private key is never sent back
 * to the browser (an empty field keeps it).
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { newPrivateKey, saveVpn, setVpnActive, vpnStatus } from '../shells/vpn-save.ts';
import type { VpnForm } from '../shells/vpn-save.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, cards, check, form, row, section, text } from './admin-layout.ts';
import type { Fields, Outcome } from './admin-firewall-actions.ts';

const saved = (): Outcome => ({ ok: t('wa.saved') });

function peerRows(server: Server, base: string): Markup {
  const st = vpnStatus(server);
  const live = new Map(st.peers.map((p) => [p.publicKey, p]));
  const rows = st.form.peers.map((p) => h('tr', {},
    h('td', { class: 'web-adm-mono' }, p.publicKey), h('td', { class: 'web-adm-mono' }, p.allowedIps), h('td', { class: 'web-adm-mono' }, live.get(p.publicKey)?.endpoint ?? (p.endpoint || '—')),
    h('td', {}, live.get(p.publicKey)?.handshake ?? t('vpnw.never')), h('td', {}, live.get(p.publicKey)?.transfer ?? '—'),
    h('td', {}, form(base, 'vpn', 'vpn-peer-del', h('input', { type: 'hidden', name: 'key', value: p.publicKey }), h('button', { type: 'submit', class: 'web-adm-small' }, t('vpnw.delete'))))));
  return h('table', { class: 'web-adm-list' }, h('tr', {}, ...[t('vpnw.publicKey'), 'AllowedIPs', 'Endpoint', t('vpnw.handshake'), t('vpnw.traffic'), ''].map((c) => h('th', {}, c))),
    rows.length ? rows : h('tr', {}, h('td', { colspan: 6 }, t('vpnw.noPeers'))));
}

export function vpnPage(server: Server, base: string): Child {
  if (server.kind !== 'linuxrouter') return h('tr', {}, h('td', {}, t('vpnw.onlyRouter')));
  const st = vpnStatus(server);
  return [
    form(base, 'vpn', 'vpn-service', cards(section(t('vpnw.tunnel'), t('vpnw.tunnelHelp'),
      check('enabled', st.active, t('vpnw.enabled')), st.error ? h('p', { class: 'web-adm-error' }, t('vpnw.fileError', { error: st.error })) : null)), buttons()),
    form(base, 'vpn', 'vpn-iface', cards(section(t('vpnw.iface'), t('vpnw.ifaceHelp'),
      row(t('vpnw.publicKey'), h('code', { class: 'web-adm-mono' }, st.publicKey ?? '—')),
      row(t('vpnw.privateKey'), h('input', { type: 'password', name: 'privateKey', value: '', autocomplete: 'off' })), check('genkey', false, t('vpnw.genkey')),
      row(t('vpnw.address'), text('address', st.form.address)), row(t('vpnw.port'), text('listenPort', st.form.listenPort)))), buttons()),
    section(t('vpnw.peers'), t('vpnw.peersHelp'), peerRows(server, base)),
    form(base, 'vpn', 'vpn-peer-add', cards(section(t('vpnw.newPeer'), t('vpnw.newPeerHelp'),
      row(t('vpnw.publicKey'), text('publicKey', '')), row('AllowedIPs', text('allowedIps', '', { placeholder: '10.10.0.2/32, 192.168.2.0/24' })),
      row('Endpoint', text('endpoint', '', { placeholder: '203.0.113.2:51820' })), row('Keepalive', text('keepalive', '', { placeholder: '25' })))), buttons()),
  ];
}

function withForm(server: Server, change: (f: VpnForm) => VpnForm): Outcome {
  const err = saveVpn(server, change(vpnStatus(server).form));
  return err ? { error: t('vpnw.badValue', { error: err }) } : saved();
}

/** Form actions of the VPN page; null when the action is not one of them. */
export function vpnAction(server: Server, f: Fields): Outcome | null {
  if (!(f.get('action') ?? '').startsWith('vpn-')) return null;
  if (server.kind !== 'linuxrouter') return { error: t('vpnw.onlyRouter') };
  switch (f.get('action')) {
    case 'vpn-service': { const err = setVpnActive(server, f.has('enabled')); return err ? { error: err } : saved(); }
    case 'vpn-iface': return withForm(server, (cur) => ({
      ...cur,
      privateKey: f.has('genkey') ? newPrivateKey() : (f.get('privateKey') ?? '').trim() || cur.privateKey,
      address: f.get('address') ?? cur.address, listenPort: f.get('listenPort') ?? cur.listenPort,
    }));
    case 'vpn-peer-add': return withForm(server, (cur) => ({ ...cur, peers: [...cur.peers.filter((p) => p.publicKey !== (f.get('publicKey') ?? '').trim()), { publicKey: f.get('publicKey') ?? '', allowedIps: f.get('allowedIps') ?? '', endpoint: f.get('endpoint') ?? '', keepalive: f.get('keepalive') ?? '' }] }));
    case 'vpn-peer-del': return withForm(server, (cur) => ({ ...cur, peers: cur.peers.filter((p) => p.publicKey !== f.get('key')) }));
    default: return { error: t('wa.unknownAction') };
  }
}
