/**
 * Undo and redo of the edits made on the workspace: adding, deleting and moving devices, cables and drawings.
 * A deleted device is kept as it was (same object, running state and configuration) so undoing brings it back
 * exactly. The configuration typed in a device (CLI, panels) is not part of this history, as in Packet Tracer.
 */
import type { Topology, DeviceKind, Placed } from './topology.ts';
import type { CableKind, Endpoint, Link } from './network.ts';
import type { Annotation, Point } from './annotations.ts';

export const MAX_EDITS = 100;
/** Drawing changes closer than this (the RGB picker fires on every frame) are one step. */
const MERGE_MS = 800;

interface Cable {
  readonly a: Endpoint;
  readonly b: Endpoint;
  readonly cable: CableKind;
}

export type Edit =
  | { readonly kind: 'add'; readonly id: string; readonly placed: Placed }
  | { readonly kind: 'remove'; readonly id: string; readonly placed: Placed; readonly cables: readonly Cable[] }
  | { readonly kind: 'connect' | 'disconnect'; readonly cable: Cable }
  | { readonly kind: 'move'; readonly id: string; readonly from: Point; readonly to: Point }
  | { readonly kind: 'drawings'; readonly before: readonly Annotation[]; readonly after: readonly Annotation[]; readonly at: number };

/**
 * What an undo or redo did; `removed` lists the devices taken off the workspace (their windows must close) and
 * `skipped` the cables that could not be plugged again (a port taken since then).
 */
export interface Applied {
  readonly kind: Edit['kind'];
  readonly removed: readonly string[];
  readonly skipped: number;
}

const histories = new WeakMap<Topology, EditHistory>();

/** The history of a workspace (kept while the topology lives, so rebuilding the interface does not lose it). */
export function historyFor(topo: Topology): EditHistory {
  let h = histories.get(topo);
  if (!h) {
    h = new EditHistory(topo);
    histories.set(topo, h);
  }
  return h;
}

const cableOf = (l: Link): Cable => ({ a: l.a, b: l.b, cable: l.cable });
const sameEp = (x: Endpoint, y: Endpoint): boolean => x.device === y.device && x.port === y.port;

export class EditHistory {
  private readonly topo: Topology;
  private skipped = 0;
  private done: Edit[] = [];
  private undone: Edit[] = [];
  /** The drawings as the history last saw them. */
  private seen: readonly Annotation[];

  constructor(topo: Topology) {
    this.topo = topo;
    this.seen = topo.annotations;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  addDevice(kind: DeviceKind, x: number, y: number): Placed {
    const placed = this.topo.add(kind, x, y);
    this.record({ kind: 'add', id: placed.device.id, placed });
    return placed;
  }

  removeDevice(id: string): boolean {
    const placed = this.topo.get(id);
    if (!placed) return false;
    const cables = this.topo.net.links.filter((l) => l.a.device === id || l.b.device === id).map(cableOf);
    this.topo.remove(id);
    this.record({ kind: 'remove', id, placed, cables });
    return true;
  }

  connect(a: Endpoint, b: Endpoint): Link {
    const link = this.topo.connect(a, b);
    this.record({ kind: 'connect', cable: cableOf(link) });
    return link;
  }

  disconnect(linkId: string): void {
    const link = this.topo.net.links.find((l) => l.id === linkId);
    if (!link) return;
    this.topo.net.disconnect(linkId);
    this.record({ kind: 'disconnect', cable: cableOf(link) });
  }

  /** A device was dragged from `from` to where it is now. */
  moved(id: string, from: Point): void {
    const p = this.topo.get(id);
    if (p && (p.x !== from.x || p.y !== from.y)) this.record({ kind: 'move', id, from, to: { x: p.x, y: p.y } });
  }

  /** Records the drawings changed since the last call (drawings are immutable lists, so a change is a new list). */
  syncDrawings(now: number): void {
    const after = this.topo.annotations;
    if (after === this.seen) return;
    const last = this.done[this.done.length - 1];
    const merge = last?.kind === 'drawings' && now - last.at < MERGE_MS && this.undone.length === 0;
    const before = merge ? last.before : this.seen;
    if (merge) this.done.pop();
    this.seen = after;
    this.push({ kind: 'drawings', before, after, at: now });
  }

  undo(): Applied | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return this.apply(e, true);
  }

  redo(): Applied | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return this.apply(e, false);
  }

  private record(e: Edit): void {
    this.syncDrawings(Number.NEGATIVE_INFINITY);
    this.push(e);
  }

  private push(e: Edit): void {
    this.done = [...this.done.slice(-(MAX_EDITS - 1)), e];
    this.undone = [];
  }

  /** Runs an edit backwards (undo) or forwards (redo). */
  private apply(e: Edit, back: boolean): Applied {
    const removed: string[] = [];
    this.skipped = 0;
    switch (e.kind) {
      case 'add':
      case 'remove':
        if ((e.kind === 'add') !== back) this.restore(e);
        else {
          this.topo.remove(e.id);
          removed.push(e.id);
        }
        break;
      case 'connect':
      case 'disconnect':
        if ((e.kind === 'connect') !== back) this.plug(e.cable);
        else this.unplug(e.cable);
        break;
      case 'move':
        this.place(e.id, back ? e.from : e.to);
        break;
      case 'drawings':
        this.topo.annotations = back ? e.before : e.after;
        this.seen = this.topo.annotations;
    }
    return { kind: e.kind, removed, skipped: this.skipped };
  }

  private place(id: string, to: Point): void {
    const p = this.topo.get(id);
    if (!p) return;
    p.x = to.x;
    p.y = to.y;
  }

  private restore(e: Extract<Edit, { kind: 'add' | 'remove' }>): void {
    this.topo.restorePlaced(e.id, e.placed);
    if (e.kind === 'remove') for (const c of e.cables) this.plug(c);
  }

  /** Connects a cable again if both ports are still there and free (a later file or lab may have taken them). */
  private plug(c: Cable): void {
    const net = this.topo.net;
    if (!net.devices.has(c.a.device) || !net.devices.has(c.b.device) || net.linkAt(c.a) || net.linkAt(c.b)) {
      this.skipped++;
      return;
    }
    try {
      this.topo.connect(c.a, c.b, c.cable);
    } catch {
      // A port that no longer exists: the cable is left out.
      this.skipped++;
    }
  }

  private unplug(c: Cable): void {
    const link = this.topo.net.links.find((l) => sameEp(l.a, c.a) && sameEp(l.b, c.b));
    if (link) this.topo.net.disconnect(link.id);
  }
}
