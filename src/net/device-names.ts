/**
 * The name of a PC, Server, Linux router or cloud as the system sees it (host name) always comes from the name shown
 * in the workspace: lowercase, no accents, hyphens (core/hostname.ts). Two names that give the same host name («PC 1»,
 * «pc-1») get -2, -3…, so every device keeps its own. IOS devices keep their own `hostname`.
 */
import type { Placed } from './topology.ts';
import { hostnameFromLabel } from '../core/hostname.ts';

const MAX_NAME = 63;

/** The devices a placed one lives with (its topology), to keep host names apart. */
const owners = new WeakMap<Placed, () => Iterable<Placed>>();

export function registerPlaced(p: Placed, all: () => Iterable<Placed>): void {
  owners.set(p, all);
}

function freeName(p: Placed): string {
  const base = hostnameFromLabel(p.label);
  const taken = new Set([...(owners.get(p)?.() ?? [])].flatMap((o) => (o === p || o.device.kind === 'router' || o.device.kind === 'switch' ? [] : [o.device.name])));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, MAX_NAME - String(i).length - 1).replace(/-+$/, '')}-${i}`;
  return name;
}

/** Puts the derived name back on the device (after a rename or an undo that had to pick another label). */
export function syncDeviceName(p: Placed): void {
  const d = p.device;
  const name = freeName(p);
  if (d.kind === 'cloud') d.name = name;
  else if (d.kind !== 'router' && d.kind !== 'switch' && (d.name !== name || d.transientName !== undefined)) d.setHostname(name);
}

/** Equipo → name: the label and, from it, the host name. */
export function renameDevice(p: Placed, label: string): void {
  p.label = label;
  syncDeviceName(p);
}
