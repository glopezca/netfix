/**
 * Classroom LAN window: whether this lab is in a class, NAT or bridge, and under NAT the router's LAN (DHCP), its
 * classroom address and the forwarded ports (as an ISP line in router mode, so the same section).
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, message, onCommit } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import { forwardsSection } from './cloud-window.ts';
import type { Tab } from './windows.ts';
import type { ClassLan, ClassLanSettings } from '../devices/classlan.ts';
import { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';

export interface ClassLanHost {
  afterCommand(): void;
  connected(port: string): string | undefined;
}

function modeRadio(d: ClassLan, change: (next: ClassLanSettings) => void): HTMLElement {
  const name = `classlan-mode-${d.id}`;
  const radio = (mode: ClassLanSettings['mode'], label: string): HTMLElement => {
    const r = el('input', { type: 'radio', name, value: mode, checked: d.settings.mode === mode });
    r.addEventListener('change', () => { if (r.checked) change({ ...d.settings, mode }); });
    return el('label', { class: 'radio' }, r, label);
  };
  return el('fieldset', { class: 'mode' }, el('legend', {}, t('classlan.mode')), radio('nat', t('classlan.nat')), radio('bridge', t('classlan.bridgeMode')));
}

function panel(d: ClassLan, app: ClassLanHost): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const s = d.settings;
    const put = (next: ClassLanSettings): void => {
      const err = d.setSettings(next);
      if (err) return msg.error(err);
      app.afterCommand();
      refresh();
    };
    const at = d.classAddress();
    const peer = app.connected('Ethernet0');
    const status = !d.connected() ? t('classlan.notInClass') : s.mode === 'bridge' ? t('classlan.inClassBridge') : t('classlan.inClassNat', { ip: formatIp(at ?? 0) });
    const parts: HTMLElement[] = [
      el('p', { class: 'status', 'data-state': d.connected() ? 'ok' : 'failed' }, status),
      el('p', { class: 'muted' }, peer ? t('cloud.connected', { peer }) : t('cloud.noCable')),
      modeRadio(d, put),
      el('p', { class: 'muted' }, s.mode === 'nat' ? t('classlan.natHint') : t('classlan.bridgeHint')),
      msg.el,
    ];
    if (s.mode === 'bridge') return parts;
    const lan = input({ value: formatIp(s.router.lanIp) });
    const mask = input({ value: formatMask(s.router.lanPrefix) });
    const apply = (): void => {
      const ip = parseIp(lan.value.trim());
      const prefix = parseMask(mask.value.trim());
      if (ip === null || prefix === null) return msg.error(t('cloud.badLan'));
      put({ ...s, router: { ...s.router, lanIp: ip, lanPrefix: prefix } });
    };
    onCommit(lan, apply);
    onCommit(mask, apply);
    const leases = d.router.leases().map((b) => `${formatIp(b.ip)} → ${b.hostname ?? b.mac}`);
    return [...parts,
      el('div', { class: 'grid2' }, field(t('cloud.routerLan'), lan), field(t('cloud.lanMask'), mask)),
      el('p', { class: 'muted' }, t('cloud.lanDhcp', { net: `${formatIp(s.router.lanIp)}/${s.router.lanPrefix}` })),
      el('p', { class: 'muted' }, t('cloud.leases', { list: leases.join(' · ') || t('cloud.none') })),
      ...forwardsSection(d.router, (forwards) => put({ ...s, router: { ...s.router, forwards } }))];
  });
}

export function classLanTabs(d: ClassLan, app: ClassLanHost): Tab[] {
  return [{ id: 'classlan', label: t('classlan.tab'), render: () => panel(d, app) }];
}
