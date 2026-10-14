/**
 * PC / Server → «Interfaces»: every NIC with its Linux name, MAC, cable (far end), address and administrative
 * state (the same as `ip link set dev eth0 up|down` and the «Port Status» switch of Packet Tracer).
 */
import { el } from './dom.ts';
import { onOff, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Host } from '../devices/host.ts';
import type { NicInfo } from '../devices/host-nics.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

/** FastEthernet ports run at 100 Mb/s, GigabitEthernet ones at 1 Gb/s (full duplex, autonegotiated). */
function speedOf(port: string): string {
  return port.startsWith('Gigabit') ? '1000 Mb/s' : '100 Mb/s';
}

function linkText(n: NicInfo): string {
  if (!n.adminUp) return t('router.down');
  return n.up ? t('router.up') : `${t('router.up')} (${t('router.noCable')})`;
}

export function hostInterfaces(h: Host, app: AfterChange, peer: (port: string) => string | undefined): LivePanel {
  return liveHostPanel(h, () => {
    const nics = h.nics();
    const toggles = nics.map((n) => onOff(`${n.port} (${n.linux})`, n.adminUp, (on) => { h.setNicUp(n.port, on); app.afterCommand(); }));
    return [
      el('p', { class: 'muted' }, t('hostif.intro')),
      table<NicInfo>(nics, [
        { label: t('iosif.iface'), value: (n) => `${n.port} · ${n.linux}`, mono: true },
        { label: 'MAC', value: (n) => n.mac, mono: true },
        { label: t('iosif.state'), value: linkText },
        { label: t('hostif.address'), value: (n) => (n.ip !== undefined && n.prefix !== undefined ? `${formatIp(n.ip)} ${formatMask(n.prefix)}${n.dhcp ? ' (DHCP)' : ''}` : '—'), mono: true },
        { label: t('hostif.speed'), value: (n) => t('hostif.speedValue', { speed: speedOf(n.port) }) },
        { label: t('hostif.peer'), value: (n) => peer(n.port) ?? t('router.noCable') },
      ], { empty: '—' }),
      el('h3', {}, t('hostif.portStatus')),
      ...toggles,
      el('h3', {}, t('host.equivalents')),
      el('ul', { class: 'muted' }, el('li', {}, t('hostif.eqLinux')), el('li', {}, t('hostif.eqWindows')), el('li', {}, t('hostif.eqIp'))),
    ];
  });
}
