/** Topology and discrete-event engine. Every frame on a cable is recorded for simulation mode. */
import { TaskQueue } from './task-queue.ts';
import { SimClock } from '../core/clock.ts';
import type { Frame } from './packets.ts';
import { frameProtocol } from './packets.ts';
import type { DeviceHooks } from '../devices/hooks.ts';

export interface Endpoint {
  readonly device: string;
  readonly port: string;
}

export type CableKind = 'straight' | 'cross' | 'auto';

export interface Link {
  readonly id: string;
  readonly a: Endpoint;
  readonly b: Endpoint;
  readonly cable: CableKind;
}

/** What the network needs from a device. */
export interface NetDevice {
  readonly id: string;
  readonly kind: 'router' | 'switch' | 'pc' | 'server' | 'linuxrouter' | 'cloud';
  hooks: DeviceHooks;
  displayName(): string;
  portNames(): readonly string[];
  /** Port administratively enabled (no shutdown). */
  portAdminUp(port: string): boolean;
  receive(port: string, frame: Frame): void;
  /** Cable plugged/unplugged or far end changed state. */
  onLinkEvent(port: string, up: boolean): void;
  ownsIp(ip: number): boolean;
  /** Switch ports configured with `switchport mode trunk` (DTP negotiation). */
  configuredTrunk?(port: string): boolean;
}

export interface SimEvent {
  readonly seq: number;
  /** Simulation time (ms since start) at which the frame arrives. */
  readonly time: number;
  readonly linkId: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  readonly protocol: string;
  readonly frame: Frame;
}

export const LINK_DELAY_MS = 1;
const MAX_HISTORY = 5000;
const HISTORY_SLACK = 1000;
const MAX_TASKS_PER_RUN = 200_000;
/** Frames in flight beyond this are dropped (congestion): a switching loop saturates instead of growing forever. */
const MAX_IN_FLIGHT = 20_000;

/** The work limit ran out (headless marking of an untrusted topology). */
export class WorkLimitError extends Error {}

let workLeft = Infinity;

/** Runs `fn` allowing at most `tasks` simulation tasks in all; beyond that, WorkLimitError. */
export function withWorkLimit<T>(tasks: number, fn: () => T): T {
  const previous = workLeft;
  workLeft = tasks;
  try {
    return fn();
  } finally {
    workLeft = previous;
  }
}

export class Network {
  readonly clock: SimClock;
  readonly devices = new Map<string, NetDevice>();
  links: readonly Link[] = [];
  readonly history: SimEvent[] = [];
  private readonly queue = new TaskQueue<() => void>();
  /** The cable on each port ("device|port"), looked up for every frame. */
  private readonly byPort = new Map<string, Link>();
  private seq = 0;
  private readonly listeners = new Set<(e: SimEvent) => void>();

  constructor(clock: SimClock = new SimClock()) {
    this.clock = clock;
  }

  // ------------------------------------------------------------ topology

  addDevice(device: NetDevice): void {
    if (this.devices.has(device.id)) throw new Error(`Duplicate device id ${device.id}`);
    this.devices.set(device.id, device);
    device.hooks = this.hooksFor(device);
  }

  removeDevice(id: string): void {
    for (const link of this.links.filter((l) => l.a.device === id || l.b.device === id)) this.disconnect(link.id);
    this.devices.delete(id);
  }

  linkAt(ep: Endpoint): Link | undefined {
    return this.byPort.get(epKey(ep));
  }

  peerOf(ep: Endpoint): Endpoint | undefined {
    const link = this.linkAt(ep);
    if (!link) return undefined;
    return sameEp(link.a, ep) ? link.b : link.a;
  }

  connect(a: Endpoint, b: Endpoint, cable: CableKind = 'auto'): Link {
    const da = this.devices.get(a.device);
    const db = this.devices.get(b.device);
    if (!da || !db) throw new Error('Unknown device');
    if (!da.portNames().includes(a.port) || !db.portNames().includes(b.port)) throw new Error('Unknown port');
    if (this.linkAt(a) || this.linkAt(b)) throw new Error('Port already in use');
    if (a.device === b.device) throw new Error('Cannot connect a device to itself');
    const link: Link = { id: `L${++this.seq}`, a, b, cable };
    this.links = [...this.links, link];
    this.byPort.set(epKey(a), link).set(epKey(b), link);
    this.notifyLink(a, b);
    return link;
  }

  disconnect(linkId: string): void {
    const link = this.links.find((l) => l.id === linkId);
    if (!link) return;
    const wasUp = this.endUp(link.a) && this.endUp(link.b);
    this.links = this.links.filter((l) => l.id !== linkId);
    this.byPort.delete(epKey(link.a));
    this.byPort.delete(epKey(link.b));
    if (!wasUp) return;
    this.devices.get(link.a.device)?.onLinkEvent(link.a.port, false);
    this.devices.get(link.b.device)?.onLinkEvent(link.b.port, false);
  }

  /** Both ends of the cable on `ep` are administratively up. */
  linkUp(ep: Endpoint): boolean {
    const peer = this.peerOf(ep);
    return peer !== undefined && this.endUp(ep) && this.endUp(peer);
  }

  private endUp(ep: Endpoint): boolean {
    return this.devices.get(ep.device)?.portAdminUp(ep.port) ?? false;
  }

  private notifyLink(a: Endpoint, b: Endpoint): void {
    if (!this.endUp(a) || !this.endUp(b)) return;
    this.devices.get(a.device)?.onLinkEvent(a.port, true);
    this.devices.get(b.device)?.onLinkEvent(b.port, true);
  }

  private hooksFor(device: NetDevice): DeviceHooks {
    return {
      peerUp: (port) => {
        const peer = this.peerOf({ device: device.id, port });
        return peer !== undefined && this.endUp(peer);
      },
      portChanged: (port) => {
        const peer = this.peerOf({ device: device.id, port });
        if (!peer || !this.endUp(peer)) return;
        this.devices.get(peer.device)?.onLinkEvent(peer.port, device.portAdminUp(port));
      },
      transmit: (port, frame) => this.transmit({ device: device.id, port }, frame),
      schedule: (delay, fn) => this.schedule(delay, fn),
      ipInUse: (ip, except) => [...this.devices.values()].some((d) => d.id !== except && d.ownsIp(ip)),
      runUntil: (done, maxMs) => this.runUntil(done, maxMs),
      peerTrunking: (port) => {
        const peer = this.peerOf({ device: device.id, port });
        const dev = peer ? this.devices.get(peer.device) : undefined;
        return dev?.configuredTrunk?.(peer?.port ?? '') ?? false;
      },
    };
  }

  // ------------------------------------------------------------ events

  onFrame(listener: (e: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule(delayMs: number, run: () => void): void {
    this.queue.push({ time: this.clock.elapsed() + Math.max(0, delayMs), seq: ++this.seq, value: run });
  }

  transmit(from: Endpoint, frame: Frame): void {
    if (!this.linkUp(from)) return;
    const link = this.linkAt(from);
    const to = this.peerOf(from);
    if (!link || !to || this.queue.size >= MAX_IN_FLIGHT) return;
    this.schedule(LINK_DELAY_MS, () => {
      if (!this.linkUp(from)) return;
      const event: SimEvent = { seq: ++this.seq, time: this.clock.elapsed(), linkId: link.id, from, to, protocol: frameProtocol(frame), frame };
      this.record(event);
      this.devices.get(to.device)?.receive(to.port, frame);
    });
  }

  /** A packet that crossed the emulated Internet (between ISP clouds): shown in simulation mode. */
  recordVirtual(from: Endpoint, to: Endpoint, frame: Frame): void {
    this.record({ seq: ++this.seq, time: this.clock.elapsed(), linkId: 'internet', from, to, protocol: frameProtocol(frame), frame });
  }

  private record(event: SimEvent): void {
    this.history.push(event);
    // Trimmed in batches: cutting one event at a time copies the whole history on every frame (a storm took seconds).
    if (this.history.length > MAX_HISTORY + HISTORY_SLACK) this.history.splice(0, this.history.length - MAX_HISTORY);
    for (const l of this.listeners) l(event);
  }

  pending(): number {
    return this.queue.size;
  }

  /** Runs the next task. Returns false when the queue is empty. */
  step(): boolean {
    const task = this.queue.pop();
    if (!task) return false;
    if (--workLeft < 0) throw new WorkLimitError('Límite de cálculo de la simulación agotado');
    this.clock.advanceTo(task.time);
    task.value();
    return true;
  }

  /** Processes every task due within the next `ms` of simulated time. */
  runFor(ms: number): void {
    this.runUntil(() => false, ms);
  }

  /** Advances time until `done()` holds or `maxMs` elapse. Returns whether `done()` held. */
  runUntil(done: () => boolean, maxMs: number): boolean {
    const deadline = this.clock.elapsed() + maxMs;
    let budget = MAX_TASKS_PER_RUN;
    while (!done()) {
      const next = this.queue.peek();
      if (!next || next.time > deadline || budget-- <= 0) {
        this.clock.advanceTo(deadline);
        return done();
      }
      this.step();
    }
    return true;
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}

function epKey(ep: Endpoint): string {
  return `${ep.device}|${ep.port}`;
}

export function sameEp(a: Endpoint, b: Endpoint): boolean {
  return a.device === b.device && a.port === b.port;
}
