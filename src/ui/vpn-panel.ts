/** Services → VPN of the Linux router: wg0.conf as a form (interface, peers), on/off and peer status. */
import { el } from './dom.ts';
import { button, field, input, message, onOff, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import { newPrivateKey, saveVpn, setVpnActive, vpnStatus } from '../shells/vpn-save.ts';
import type { VpnForm, VpnPeerForm, VpnPeerStatus } from '../shells/vpn-save.ts';
import { pubKey } from '../core/x25519.ts';
import { t } from '../i18n/t.ts';

const short = (key: string): string => (key.length > 16 ? `${key.slice(0, 12)}…` : key);

function peerForm(add: (p: VpnPeerForm) => void): HTMLElement {
  const key = input({ class: 'mono', 'aria-label': t('vpn.peerKey') });
  const ips = input({ placeholder: '10.10.0.2/32, 192.168.2.0/24', 'aria-label': t('vpn.allowedIps') });
  const ep = input({ placeholder: '203.0.113.2:51820', 'aria-label': t('vpn.endpoint') });
  const ka = input({ placeholder: '25', inputmode: 'numeric', 'aria-label': t('vpn.keepalive') });
  return el('div', { class: 'fw-form' },
    field(t('vpn.peerKey'), key), el('div', { class: 'grid2' }, field(t('vpn.allowedIps'), ips), field(t('vpn.endpoint'), ep)), field(t('vpn.keepalive'), ka),
    button(t('vpn.addPeer'), () => add({ publicKey: key.value, allowedIps: ips.value, endpoint: ep.value, keepalive: ka.value })));
}

function statusTable(peers: readonly VpnPeerStatus[]): HTMLElement {
  return table<VpnPeerStatus>(peers, [
    { label: t('vpn.peerKey'), value: (p) => short(p.publicKey), mono: true },
    { label: 'Endpoint', value: (p) => p.endpoint ?? '—', mono: true },
    { label: t('vpn.handshake'), value: (p) => p.handshake ?? t('vpn.never') },
    { label: t('vpn.transfer'), value: (p) => p.transfer ?? '—' },
  ], { empty: t('vpn.noPeers') });
}

export function vpnPanel(s: Server, app: AfterChange): LivePanel {
  // Outside the redraw: an action that changes the device redraws the panel before reporting.
  const msg = message();
  return liveHostPanel(s, () => {
    if (s.kind !== 'linuxrouter') return [el('p', { class: 'muted' }, t('vpn.notRouter'))];
    const st = vpnStatus(s);
    const priv = input({ value: st.form.privateKey, class: 'mono', type: 'password', autocomplete: 'off', 'aria-label': t('vpn.privateKey') });
    const pub = el('code', { class: 'mono' }, st.publicKey ?? '—');
    priv.addEventListener('input', () => { pub.textContent = pubKey(priv.value.trim()) ?? '—'; });
    const addr = input({ value: st.form.address, 'aria-label': t('vpn.address') });
    const port = input({ value: st.form.listenPort, inputmode: 'numeric', 'aria-label': t('vpn.listenPort') });
    const form = (peers: readonly VpnPeerForm[]): VpnForm => ({ privateKey: priv.value, address: addr.value, listenPort: port.value, peers });
    const save = (peers: readonly VpnPeerForm[]): void => {
      const err = saveVpn(s, form(peers));
      if (err) msg.error(t('vpn.bad', { field: err }));
      else { msg.ok(t('vpn.saved')); app.afterCommand(); }
    };
    const generate = (): void => {
      if (st.form.privateKey && !globalThis.confirm(t('vpn.confirmKeys'))) return;
      priv.value = newPrivateKey();
      pub.textContent = pubKey(priv.value) ?? '—';
    };
    const peers = table<VpnPeerForm>(st.form.peers, [
      { label: t('vpn.peerKey'), value: (p) => short(p.publicKey), mono: true },
      { label: 'AllowedIPs', value: (p) => p.allowedIps, mono: true },
      { label: 'Endpoint', value: (p) => p.endpoint || '—', mono: true },
      { label: 'Keepalive', value: (p) => p.keepalive || '—' },
    ], { empty: t('vpn.noPeers'), onDelete: (p) => save(st.form.peers.filter((x) => x !== p)) });
    return [
      el('p', { class: 'muted' }, t('vpn.intro')),
      onOff(t('vpn.service'), st.active, (on) => { const err = setVpnActive(s, on); if (err) msg.error(err); app.afterCommand(); }),
      ...(st.error ? [el('p', { class: 'status', 'data-state': 'failed' }, `${t('vpn.fileError')} ${st.error}`)] : []),
      msg.el,
      el('h3', {}, t('vpn.interface')),
      field(t('vpn.privateKey'), priv), el('div', { class: 'row-actions' }, button(t('vpn.generate'), generate, 'btn btn-small')),
      field(t('vpn.publicKey'), pub),
      el('div', { class: 'grid2' }, field(t('vpn.address'), addr), field(t('vpn.listenPort'), port)),
      el('div', { class: 'row-actions' }, button(t('vpn.save'), () => save(st.form.peers))),
      el('h3', {}, t('vpn.peers')), peers, peerForm((p) => save([...st.form.peers, p])),
      el('h3', {}, t('vpn.status')), statusTable(st.peers),
    ];
  });
}
