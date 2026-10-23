/**
 * The name of every device as its system sees it (host name) always comes from the name shown in the workspace
 * (core/hostname.ts): lowercase with hyphens for PCs, servers, Linux routers and clouds; for IOS routers and switches
 * the `hostname`, keeping case. Two names that give the same host name («PC 1», «pc-1») get -2, -3…, so every device
 * keeps its own (IOS names among IOS devices, compared without case).
 */
import type { DeviceRecord, Placed } from './topology.ts';
import { hostnameFromLabel, iosHostnameFromLabel } from '../core/hostname.ts';

const MAX_NAME = 63;

/** The devices a placed one lives with (its topology), to keep host names apart. */
const owners = new WeakMap<Placed, () => Iterable<Placed>>();

export function registerPlaced(p: Placed, all: () => Iterable<Placed>): void {
  owners.set(p, all);
}

const isIos = (p: Placed): boolean => p.device.kind === 'router' || p.device.kind === 'switch';
/** The name a device shows now (IOS: compared without case). */
const shown = (p: Placed): string => (p.device.kind === 'router' || p.device.kind === 'switch' ? p.device.hostname.toLowerCase() : p.device.name);

function freeName(p: Placed): string {
  const d = p.device;
  const base = d.kind === 'router' || d.kind === 'switch' ? iosHostnameFromLabel(p.label, d.kind) : hostnameFromLabel(p.label);
  const ios = isIos(p);
  const taken = new Set([...(owners.get(p)?.() ?? [])].flatMap((o) => (o === p || isIos(o) !== ios ? [] : [shown(o)])));
  const key = (n: string): string => (ios ? n.toLowerCase() : n);
  let name = base;
  for (let i = 2; taken.has(key(name)); i++) name = `${base.slice(0, MAX_NAME - String(i).length - 1).replace(/-+$/, '')}-${i}`;
  return name;
}

/** Puts the derived name back on the device (after a rename or an undo that had to pick another label). */
export function syncDeviceName(p: Placed): void {
  const d = p.device;
  const name = freeName(p);
  if (d.kind === 'cloud') d.name = name;
  else if (d.kind === 'router' || d.kind === 'switch') d.setDerivedHostname(name);
  else if (d.name !== name || d.transientName !== undefined) d.setHostname(name);
}

/** Equipo → name: the label and, from it, the host name. */
export function renameDevice(p: Placed, label: string): void {
  p.label = label;
  syncDeviceName(p);
}

const IOS_DEFAULT = /^(Router|Switch)$/;
const MAX_LABEL = 64;

/**
 * The name a saved device opens with. Before v0.19.4 an IOS hostname was set apart from the name (CLI `hostname`):
 * a file whose running-config names the router otherwise opens with that hostname as its name, so the student's
 * work keeps its prompt and both stay in step from then on, unless another device has that name. Files of this
 * version always agree.
 */
export function savedLabel(rec: DeviceRecord, taken: Set<string>): string {
  if (rec.kind !== 'router' && rec.kind !== 'switch') return rec.label;
  const line = rec.config?.find((l) => l.startsWith('hostname '));
  const name = line?.slice('hostname '.length).trim() ?? '';
  if (!name || IOS_DEFAULT.test(name) || name.length > MAX_LABEL || iosHostnameFromLabel(rec.label, rec.kind) === name) return rec.label;
  // Another device already has (or took) that name: this one keeps its own, so names stay unique.
  if (taken.has(name)) return rec.label;
  taken.add(name);
  return name;
}
