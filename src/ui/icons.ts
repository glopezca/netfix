/** Device artwork: generic network-diagram symbols drawn for this project. */
import { t } from '../i18n/t.ts';
import type { DeviceKind } from '../net/topology.ts';

export const ICON_W = 64;
export const ICON_H = 48;

const ROUTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M4 16 v14 c0 6 12.5 11 28 11 s28-5 28-11 V16" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <ellipse cx="32" cy="16" rx="28" ry="11" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <g stroke="var(--dev-mark)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M22 10 l6 4 M22 10 l2.5 -0.2 M22 10 l1.2 2.2"/>
    <path d="M42 22 l-6 -4 M42 22 l-2.5 0.2 M42 22 l-1.2 -2.2"/>
    <path d="M42 10 l-6 4 M36 14 l2.6 0 M36 14 l0.9 -2.3"/>
    <path d="M22 22 l6 -4 M28 18 l-2.6 0 M28 18 l-0.9 2.3"/>
  </g>
</svg>`;

const SWITCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M4 18 l10 -10 h46 l-10 10 z" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M4 18 h46 v20 h-46 z" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <path d="M50 18 l10 -10 v20 l-10 10 z" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.5" stroke-linejoin="round"/>
  <g stroke="var(--dev-mark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M17 10.5 h22 M35 8.5 l4 2 l-4 2"/>
    <path d="M45 15.5 h-22 M27 13.5 l-4 2 l4 2"/>
  </g>
  <g fill="var(--dev-port)">
    <rect x="9" y="27" width="5" height="4" rx="0.6"/><rect x="16" y="27" width="5" height="4" rx="0.6"/>
    <rect x="23" y="27" width="5" height="4" rx="0.6"/><rect x="30" y="27" width="5" height="4" rx="0.6"/>
    <rect x="37" y="27" width="5" height="4" rx="0.6"/>
  </g>
</svg>`;

const PC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <rect x="14" y="3" width="36" height="27" rx="2.5" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <rect x="18" y="7" width="28" height="19" rx="1" fill="var(--dev-screen)"/>
  <path d="M28 30 h8 l2 7 h-12 z" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.2" stroke-linejoin="round"/>
  <rect x="18" y="37" width="28" height="5" rx="1.5" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.2"/>
</svg>`;

const SERVER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M20 5 l8 -3 h20 l-8 3 z" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M40 5 l8 -3 v40 l-8 3 z" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.4" stroke-linejoin="round"/>
  <rect x="20" y="5" width="20" height="40" rx="1.5" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <g fill="var(--dev-port)">
    <rect x="23" y="9" width="14" height="3" rx="0.8"/><rect x="23" y="15" width="14" height="3" rx="0.8"/><rect x="23" y="21" width="14" height="3" rx="0.8"/>
  </g>
  <circle cx="25" cy="39" r="1.6" fill="var(--dev-mark)"/><path d="M29 39 h7" stroke="var(--dev-mark)" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

const CLOUD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M16 40 h34 a10 10 0 0 0 1 -19.9 a14 14 0 0 0 -26.5 -4.6 a10.5 10.5 0 0 0 -8.5 24.5 z" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.6" stroke-linejoin="round"/>
  <g stroke="var(--dev-mark)" stroke-width="1.6" fill="none" stroke-linecap="round">
    <circle cx="32" cy="29" r="7"/><path d="M25 29 h14 M32 22 c-3 4 -3 10 0 14 M32 22 c3 4 3 10 0 14"/>
  </g>
</svg>`;

/** Both routers (IOS and Linux) share the router symbol; the model line («2911» / «Ubuntu») tells them apart. */
export const ICONS: Readonly<Record<DeviceKind, string>> = { router: ROUTER, switch: SWITCH, pc: PC, server: SERVER, linuxrouter: ROUTER, cloud: CLOUD };

export const MODEL_LABEL: Readonly<Record<DeviceKind, string>> = { router: '2911', switch: '2960-24TT', pc: 'PC', server: 'Server', linuxrouter: 'Ubuntu', cloud: 'ISP' };

/** Model label shown under the icon (the cloud is translated). */
export function modelLabel(kind: DeviceKind): string {
  return kind === 'cloud' ? t('model.cloud') : MODEL_LABEL[kind];
}

