/**
 * Clipboard of the workspace: copy a selection (devices with their configuration, the cables between them and
 * drawings) as a snapshot, and paste it as new devices with their own names, seeds (MACs) and public blocks.
 */
import { record, restore } from './topology.ts';
import type { DeviceKind, DeviceRecord, Placed, Topology } from './topology.ts';
import type { CableKind, Endpoint, Link } from './network.ts';
import type { Annotation } from './annotations.ts';
import { moveAnnotation } from './annotations.ts';
import { syncDeviceName } from './device-names.ts';
import { Host } from '../devices/host.ts';
import { LinuxRouter } from '../devices/linux-router.ts';
import { bootWireguard } from '../shells/wg-boot.ts';

/** Offset of each paste from the copied items, so the copy is not hidden under the original. */
export const PASTE_OFFSET = 40;

export interface Clip {
  readonly devices: readonly DeviceRecord[];
  readonly links: readonly { readonly a: Endpoint; readonly b: Endpoint; readonly cable: CableKind }[];
  readonly drawings: readonly Annotation[];
}

export interface Pasted {
  readonly devices: readonly Placed[];
  readonly links: readonly Link[];
  readonly drawings: readonly Annotation[];
}

export function copyClip(topo: Topology, deviceIds: readonly string[], drawingIds: readonly string[]): Clip {
  const ids = new Set(deviceIds.filter((id) => topo.placed.has(id)));
  const devices = [...ids].map((id) => record(id, topo.placed.get(id) as Placed));
  const links = topo.net.links.filter((l) => ids.has(l.a.device) && ids.has(l.b.device)).map((l) => ({ a: l.a, b: l.b, cable: l.cable }));
  const wanted = new Set(drawingIds);
  return { devices, links, drawings: topo.annotations.filter((a) => wanted.has(a.id)) };
}

/** Size of the workspace: pasted devices stay this far inside it. */
export interface Bounds {
  readonly w: number;
  readonly h: number;
  readonly margin: number;
}

export function pasteClip(topo: Topology, clip: Clip, offset: number, bounds?: Bounds): Pasted {
  const fit = (v: number, size: number | undefined): number => (bounds && size !== undefined ? Math.max(bounds.margin, Math.min(size - bounds.margin, v)) : v);
  const ids = new Map<string, string>();
  const devices = clip.devices.map((rec) => {
    const placed = topo.add(rec.kind, fit(rec.x + offset, bounds?.w), fit(rec.y + offset, bounds?.h));
    restore(placed.device, rec);
    syncDeviceName(placed);
    ids.set(rec.id, placed.device.id);
    return placed;
  });
  topo.separateClouds();
  const links = clip.links.flatMap((l) => {
    const a = { device: ids.get(l.a.device) ?? '', port: l.a.port };
    const b = { device: ids.get(l.b.device) ?? '', port: l.b.port };
    try {
      return [topo.connect(a, b, l.cable)];
    } catch {
      return []; // the port does not exist: the cable is left out
    }
  });
  const drawings = clip.drawings.flatMap((d) => {
    const added = topo.addAnnotation(moveAnnotation(d, offset, offset));
    return added ? [added] : [];
  });
  for (const p of devices) {
    if (p.device instanceof Host && p.device.config.mode === 'dhcp') p.device.useDhcp();
    if (p.device instanceof LinuxRouter) bootWireguard(p.device);
  }
  return { devices, links, drawings };
}

/** The clip without the device kinds the classroom does not allow (and without their cables). */
export function onlyKinds(clip: Clip, allowed: (kind: DeviceKind) => boolean): Clip {
  const devices = clip.devices.filter((d) => allowed(d.kind));
  const ids = new Set(devices.map((d) => d.id));
  return { ...clip, devices, links: clip.links.filter((l) => ids.has(l.a.device) && ids.has(l.b.device)) };
}
