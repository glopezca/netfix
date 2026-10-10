/** Device artwork: generic network-diagram symbols drawn for this project. */
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

export const ICONS: Readonly<Record<DeviceKind, string>> = { router: ROUTER, switch: SWITCH, pc: PC };

export const MODEL_LABEL: Readonly<Record<DeviceKind, string>> = { router: '2911', switch: '2960-24TT', pc: 'PC-PT' };

export const KIND_NAME: Readonly<Record<DeviceKind, string>> = { router: 'Router', switch: 'Switch', pc: 'PC' };
