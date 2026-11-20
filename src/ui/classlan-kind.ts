/**
 * The Classroom LAN's look in the editor (S23): its palette button (only with the host's link, one per lab), icon,
 * window, the line under it and its gateway at the cable end, through ui/device-kind-ui.ts. It moves to FixIT
 * Classroom's pack in S23 phase 2. The host option `classroomLan` decides whether it is offered (ui/host-options.ts).
 */
import { t } from '../i18n/t.ts';
import { formatIp } from '../core/ip.ts';
import { ClassLan } from '../devices/classlan.ts';
import { CLASSLAN_KIND } from '../devices/classlan-kind.ts';
import { deviceUi, registerDeviceUi } from './device-kind-ui.ts';
import { classLanTabs } from './classlan-window.ts';
import { registerHostOption } from './host-options.ts';
import { classLanHost, parseClassLan } from './lan-chooser.ts';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M16 40 h34 a10 10 0 0 0 1 -19.9 a14 14 0 0 0 -26.5 -4.6 a10.5 10.5 0 0 0 -8.5 24.5 z" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.6" stroke-linejoin="round"/>
  <g stroke="var(--dev-mark)" stroke-width="1.6" fill="none" stroke-linejoin="round">
    <rect x="21" y="21" width="8" height="6"/><rect x="35" y="21" width="8" height="6"/><rect x="28" y="31" width="8" height="6"/><path d="M29 24 h6 M32 27 v4"/>
  </g>
</svg>`;


function caption(d: ClassLan): string[] {
  const at = d.classAddress();
  return [d.settings.mode === 'bridge' ? t('classlan.bridge') : at === null ? t('classlan.offline') : `NAT ${formatIp(at)}`];
}

function gateway(d: ClassLan): string[] {
  const a = d.settings.mode === 'nat' ? d.router.gatewayAddr() : undefined;
  return a?.ip !== undefined && a.prefix !== undefined ? [`${formatIp(a.ip)}/${a.prefix}`] : [];
}

export function registerClassLanUi(): void {
  if (deviceUi(CLASSLAN_KIND)) return;
  registerDeviceUi(CLASSLAN_KIND, {
    name: () => t('kind.classlan'),
    model: () => t('model.classlan'),
    icon: ICON,
    windowTitle: (label) => t('win.classlan', { name: label }),
    tabs: (d, ctx) => (d instanceof ClassLan ? classLanTabs(d, ctx) : []),
    caption: (d) => (d instanceof ClassLan ? caption(d) : []),
    portAddresses: (d) => (d instanceof ClassLan ? gateway(d) : []),
    oneOnly: () => t('pal.classlanOne'),
  });
  // Placeable only when the host page (Netfix Classroom) gives the link to the class, or the classes to choose from.
  registerHostOption('classroomLan', { kind: CLASSLAN_KIND, parse: parseClassLan, start: (v) => classLanHost(v) });
}
