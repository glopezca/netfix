/** A workspace: devices with positions and labels, links, and JSON persistence. */
import { Network } from './network.ts';
import type { CableKind, Endpoint, Link } from './network.ts';
import { SimClock } from '../core/clock.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { Pc } from '../devices/pc.ts';
import type { IpMode } from '../devices/pc.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp, formatIp, parseMask } from '../core/ip.ts';

export type DeviceKind = 'router' | 'switch' | 'pc';
export type AnyDevice = Router | Switch | Pc;

export interface Placed {
  readonly device: AnyDevice;
  label: string;
  x: number;
  y: number;
}

export interface PcRecord {
  readonly mode: IpMode;
  readonly ip?: string;
  readonly mask?: string;
  readonly gateway?: string;
  readonly dns?: string;
  readonly sendClientId?: boolean;
}

export interface DeviceRecord {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  readonly config?: readonly string[];
  readonly startup?: readonly string[] | null;
  readonly pc?: PcRecord;
}

export interface TopologyFile {
  readonly format: 'netsim';
  readonly version: 1;
  readonly devices: readonly DeviceRecord[];
  readonly links: readonly { readonly a: Endpoint; readonly b: Endpoint; readonly cable: CableKind }[];
}

const PREFIX: Readonly<Record<DeviceKind, string>> = { router: 'Router', switch: 'Switch', pc: 'PC' };
const SETTLE_MS = 30_000;

export class Topology {
  readonly clock = new SimClock();
  readonly net = new Network(this.clock);
  readonly placed = new Map<string, Placed>();
  private nextSeed = 1;
  private nextId = 1;

  add(kind: DeviceKind, x: number, y: number, opts: { id?: string; seed?: number; label?: string } = {}): Placed {
    const id = opts.id ?? `d${this.nextId++}`;
    const seed = opts.seed ?? this.nextSeed++;
    this.nextSeed = Math.max(this.nextSeed, seed + 1);
    const label = opts.label ?? this.nextLabel(kind);
    const device = createDevice(kind, id, seed, this.clock, label);
    seeds.set(device, seed);
    this.net.addDevice(device);
    const placed: Placed = { device, label, x, y };
    this.placed.set(id, placed);
    return placed;
  }

  private nextLabel(kind: DeviceKind): string {
    const used = new Set([...this.placed.values()].map((p) => p.label));
    for (let i = 0; ; i++) if (!used.has(`${PREFIX[kind]}${i}`)) return `${PREFIX[kind]}${i}`;
  }

  remove(id: string): void {
    this.net.removeDevice(id);
    this.placed.delete(id);
  }

  get(id: string): Placed | undefined {
    return this.placed.get(id);
  }

  byLabel(label: string): AnyDevice | undefined {
    return [...this.placed.values()].find((p) => p.label === label)?.device;
  }

  connect(a: Endpoint, b: Endpoint, cable: CableKind = 'auto'): Link {
    return this.net.connect(a, b, cable);
  }

  /** First free port of a device (PT-like auto-connect). */
  freePort(id: string): string | undefined {
    const dev = this.net.devices.get(id);
    return dev?.portNames().find((p) => !this.net.linkAt({ device: id, port: p }));
  }

  settle(ms = SETTLE_MS): void {
    this.net.runFor(ms);
  }

  toJSON(): TopologyFile {
    const devices = [...this.placed.entries()].map(([id, p]) => record(id, p));
    return { format: 'netsim', version: 1, devices, links: this.net.links.map((l) => ({ a: l.a, b: l.b, cable: l.cable })) };
  }

  static fromJSON(data: unknown): Topology {
    const file = validateFile(data);
    const topo = new Topology();
    for (const d of file.devices) {
      const placed = topo.add(d.kind, d.x, d.y, { id: d.id, seed: d.seed, label: d.label });
      restore(placed.device, d);
      const n = Number(/^d(\d+)$/.exec(d.id)?.[1] ?? 0);
      topo.nextId = Math.max(topo.nextId, n + 1);
    }
    for (const l of file.links) topo.connect(l.a, l.b, l.cable);
    for (const p of topo.placed.values()) if (p.device instanceof Pc && p.device.config.mode === 'dhcp') p.device.useDhcp();
    topo.settle();
    return topo;
  }
}

function createDevice(kind: DeviceKind, id: string, seed: number, clock: SimClock, label: string): AnyDevice {
  if (kind === 'router') return new Router({ id, clock, seed });
  if (kind === 'switch') return new Switch({ id, clock, seed });
  return new Pc(id, label, clock, seed);
}

function record(id: string, p: Placed): DeviceRecord {
  const d = p.device;
  const seed = deviceSeed(d);
  const base = { id, kind: d.kind, label: p.label, x: Math.round(p.x), y: Math.round(p.y), seed };
  if (d instanceof Pc) {
    const c = d.config;
    const pc: PcRecord = c.mode === 'dhcp'
      ? { mode: 'dhcp', sendClientId: d.sendClientId }
      : { mode: 'static', ip: c.ip !== undefined ? formatIp(c.ip) : undefined, mask: c.prefix !== undefined ? `/${c.prefix}` : undefined,
        gateway: c.gateway !== undefined ? formatIp(c.gateway) : undefined, dns: c.dns !== undefined ? formatIp(c.dns) : undefined, sendClientId: d.sendClientId };
    return { ...base, pc };
  }
  return { ...base, config: d.runningConfig(), startup: d.startupConfig };
}

const seeds = new WeakMap<object, number>();
function deviceSeed(d: AnyDevice): number {
  return seeds.get(d) ?? 0;
}

function restore(device: AnyDevice, rec: DeviceRecord): void {
  if (device instanceof Pc) {
    const pc = rec.pc ?? { mode: 'static' as const };
    device.sendClientId = pc.sendClientId ?? true;
    if (pc.mode === 'dhcp') device.config = { mode: 'dhcp' };
    else device.setStatic(parseStatic(pc));
    return;
  }
  if (rec.config) applyConfig(device, rec.config);
  device.startupConfig = rec.startup ?? null;
}

export function parseStatic(pc: PcRecord): { ip?: number; prefix?: number; gateway?: number; dns?: number } {
  const opt = (s: string | undefined): number | undefined => (s ? parseIp(s) ?? undefined : undefined);
  return { ip: opt(pc.ip), prefix: pc.mask ? parseMask(pc.mask) ?? undefined : undefined, gateway: opt(pc.gateway), dns: opt(pc.dns) };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Validates untrusted JSON before building a topology from it. */
export function validateFile(data: unknown): TopologyFile {
  if (!isObject(data) || data.format !== 'netsim' || data.version !== 1) throw new Error('No es un archivo de netsim válido.');
  const { devices, links } = data;
  if (!Array.isArray(devices) || !Array.isArray(links)) throw new Error('Archivo incompleto: faltan dispositivos o enlaces.');
  for (const d of devices) {
    if (!isObject(d) || typeof d.id !== 'string' || !['router', 'switch', 'pc'].includes(String(d.kind))) throw new Error('Dispositivo no válido en el archivo.');
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.seed !== 'number' || typeof d.label !== 'string') throw new Error(`Datos incompletos para ${d.id}.`);
    if (d.config !== undefined && (!Array.isArray(d.config) || d.config.some((l) => typeof l !== 'string'))) throw new Error(`Configuración no válida en ${d.id}.`);
  }
  for (const l of links) {
    if (!isObject(l) || !isObject(l.a) || !isObject(l.b) || typeof l.a.device !== 'string' || typeof l.b.port !== 'string') throw new Error('Enlace no válido en el archivo.');
  }
  return data as unknown as TopologyFile;
}
