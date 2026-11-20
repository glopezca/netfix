/**
 * Guards by kind for a placed device. A registered kind's devices (net/device-kinds.ts) carry any string as `kind`,
 * so `d.kind === 'router'` no longer narrows the union by itself: these do, and never count them as built-in ones.
 */
import type { AnyDevice } from './topology.ts';

export type IosKind = Extract<AnyDevice, { kind: 'router' | 'switch' }>;
export type HostKind = Extract<AnyDevice, { kind: 'pc' | 'server' | 'linuxrouter' }>;
export type CloudKind = Extract<AnyDevice, { kind: 'cloud' }>;

export const iosOf = (d: AnyDevice): d is IosKind => d.kind === 'router' || d.kind === 'switch';
export const hostOf = (d: AnyDevice): d is HostKind => d.kind === 'pc' || d.kind === 'server' || d.kind === 'linuxrouter';
export const cloudOf = (d: AnyDevice): d is CloudKind => d.kind === 'cloud';
