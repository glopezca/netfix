/** A workspace: devices with positions and labels, links, and JSON persistence. */
import { savedFiles, restoreFiles, bootKernel } from '../shells/host-system.ts';
import { validFileRecords } from '../bash/vfs-persist.ts';
import type { FileRecord } from '../bash/vfs-persist.ts';
import { Network } from './network.ts';
import type { CableKind, Endpoint, Link } from './network.ts';
import { SimClock } from '../core/clock.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { Pc } from '../devices/pc.ts';
import { Host, validHostname } from '../devices/host.ts';
import type { IpMode, HostOs } from '../devices/host.ts';
import { Server } from '../devices/server.ts';
import { servicesToJson, servicesFromJson, mailboxesFromJson } from '../services/persist.ts';
import type { ServicesJson } from '../services/persist.ts';
import type { UnitId } from '../services/units.ts';
import type { MailMessage } from './packets.ts';
import type { MailAccount } from '../clients/mail-client.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp, formatIp, parseMask } from '../core/ip.ts';
import { parseHexId } from '../core/mac.ts';
import { registerWebApps } from '../web/apps.ts';
import { Cloud } from '../devices/cloud.ts';
import { cloudFromJson, cloudToJson } from '../devices/cloud-config.ts';
import { InternetCore } from './internet.ts';
import { populateInternet } from './internet-hosts.ts';

registerWebApps();

export type DeviceKind = 'router' | 'switch' | 'pc' | 'server' | 'cloud';
export type AnyDevice = Router | Switch | Pc | Server | Cloud;

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
  /** Custom option 61 (hex), when it is not 01 + MAC. */
  readonly clientId?: string;
  readonly os?: HostOs;
  /** Static host name (when it differs from the label) and hostnamectl's pretty name. */
  readonly hostname?: string;
  readonly prettyHostname?: string;
  /** PC apps: e-mail account, inbox and last browser URL. */
  readonly apps?: { readonly mail?: MailAccount; readonly inbox?: readonly MailMessage[]; readonly url?: string };
  /** Files created or changed from the Linux terminal (home directories, /etc, /var/www…). */
  readonly files?: readonly FileRecord[];
}

export interface ServerRecord {
  readonly services: ServicesJson;
  readonly autostart?: Partial<Record<UnitId, boolean>>;
  readonly mailboxes?: Readonly<Record<string, readonly MailMessage[]>>;
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
  readonly server?: ServerRecord;
  /** ISP cloud settings (lines, public block, registered domains). */
  readonly cloud?: unknown;
}

export interface TopologyFile {
  /** 'netsim' in files saved before the rename to Netfix (v0.4.0 and earlier). */
  readonly format: 'netfix' | 'netsim';
  readonly version: 1 | 2;
  readonly devices: readonly DeviceRecord[];
  readonly links: readonly { readonly a: Endpoint; readonly b: Endpoint; readonly cable: CableKind }[];
}

const PREFIX: Readonly<Record<DeviceKind, string>> = { router: 'Router', switch: 'Switch', pc: 'PC', server: 'Server', cloud: 'Cloud' };
export const FILE_VERSION = 2;
const SETTLE_MS = 30_000;
const MAX_PRETTY = 256;

export class Topology {
  readonly clock = new SimClock();
  readonly net = new Network(this.clock);
  readonly placed = new Map<string, Placed>();
  /** The emulated Internet shared by every ISP cloud of this workspace. */
  readonly internet = makeInternet(this.net);
  private nextSeed = 1;
  private nextId = 1;

  add(kind: DeviceKind, x: number, y: number, opts: { id?: string; seed?: number; label?: string } = {}): Placed {
    const id = opts.id ?? `d${this.nextId++}`;
    const seed = opts.seed ?? this.nextSeed++;
    this.nextSeed = Math.max(this.nextSeed, seed + 1);
    const label = opts.label ?? this.nextLabel(kind);
    const device = kind === 'cloud' ? this.newCloud(id, seed, label) : createDevice(kind, id, seed, this.clock, label);
    seeds.set(device, seed);
    this.net.addDevice(device);
    const placed: Placed = { device, label, x, y };
    this.placed.set(id, placed);
    return placed;
  }

  private newCloud(id: string, seed: number, label: string): Cloud {
    const used = [...this.placed.values()].flatMap((p) => (p.device instanceof Cloud ? [p.device.settings.block] : []));
    return new Cloud({ id, name: label, clock: this.clock, seed, core: this.internet, block: this.internet.freeBlock(used) });
  }

  /** A file may give two clouds the same public block: the later ones move to a free block. */
  private separateClouds(): void {
    const seen: number[] = [];
    for (const p of this.placed.values()) {
      const c = p.device;
      if (!(c instanceof Cloud)) continue;
      if (seen.includes(c.settings.block)) c.setSettings({ ...c.settings, block: this.internet.freeBlock([...seen, ...c.otherBlocks()]) });
      seen.push(c.settings.block);
    }
  }

  private nextLabel(kind: DeviceKind): string {
    const used = new Set([...this.placed.values()].map((p) => p.label));
    for (let i = 0; ; i++) if (!used.has(`${PREFIX[kind]}${i}`)) return `${PREFIX[kind]}${i}`;
  }

  remove(id: string): void {
    const d = this.placed.get(id)?.device;
    if (d instanceof Cloud) d.detach();
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
    return { format: 'netfix', version: FILE_VERSION, devices, links: this.net.links.map((l) => ({ a: l.a, b: l.b, cable: l.cable })) };
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
    topo.separateClouds();
    for (const l of file.links) topo.connect(l.a, l.b, l.cable);
    for (const p of topo.placed.values()) if (p.device instanceof Host && p.device.config.mode === 'dhcp') p.device.useDhcp();
    topo.settle();
    return topo;
  }
}

function makeInternet(net: Network): InternetCore {
  const core = new InternetCore((ms, fn) => net.schedule(ms, fn));
  populateInternet(core);
  const VIRTUAL_MAC = '000000000000';
  core.observer = (a, b, ip) => net.recordVirtual({ device: a, port: 'Internet' }, { device: b, port: 'Internet' }, { src: VIRTUAL_MAC, dst: VIRTUAL_MAC, ip });
  return core;
}

function createDevice(kind: Exclude<DeviceKind, 'cloud'>, id: string, seed: number, clock: SimClock, label: string): AnyDevice {
  if (kind === 'router') return new Router({ id, clock, seed });
  if (kind === 'switch') return new Switch({ id, clock, seed });
  if (kind === 'server') return new Server(id, label, clock, seed);
  return new Pc(id, label, clock, seed);
}

function record(id: string, p: Placed): DeviceRecord {
  const d = p.device;
  const seed = deviceSeed(d);
  const base = { id, kind: d.kind, label: p.label, x: Math.round(p.x), y: Math.round(p.y), seed };
  if (d instanceof Cloud) return { ...base, cloud: cloudToJson(d.settings) };
  if (d instanceof Host) {
    const pc = hostRecord(d);
    if (d instanceof Pc) return { ...base, pc: { ...pc, apps: { mail: d.mailAccount, inbox: d.inbox, url: d.browserUrl || undefined } } };
    if (!(d instanceof Server)) return { ...base, pc };
    return { ...base, pc, server: { services: servicesToJson(d.services), autostart: d.autostart, mailboxes: d.mailboxes.toJSON() } };
  }
  return { ...base, config: d.runningConfig(), startup: d.startupConfig };
}

const seeds = new WeakMap<object, number>();
function deviceSeed(d: AnyDevice): number {
  return seeds.get(d) ?? 0;
}

function hostRecord(d: Host): PcRecord {
  const c = d.config;
  const os = d.os;
  const clientId = d.clientIdOverride;
  const files = savedFiles(d);
  const names = { hostname: d.name, prettyHostname: d.prettyName };
  if (c.mode === 'dhcp') return { mode: 'dhcp', sendClientId: d.sendClientId, clientId, os, files, ...names };
  const opt = (n: number | undefined): string | undefined => (n === undefined ? undefined : formatIp(n));
  return { mode: 'static', ip: opt(c.ip), mask: c.prefix !== undefined ? `/${c.prefix}` : undefined, gateway: opt(c.gateway), dns: opt(c.dns), sendClientId: d.sendClientId, clientId, os, files, ...names };
}

function restore(device: AnyDevice, rec: DeviceRecord): void {
  if (device instanceof Cloud) {
    device.setSettings(cloudFromJson(rec.cloud, device.settings));
    return;
  }
  if (device instanceof Host) {
    const pc = rec.pc ?? { mode: 'static' as const };
    device.sendClientId = pc.sendClientId ?? true;
    device.clientIdOverride = typeof pc.clientId === 'string' ? parseHexId(pc.clientId) ?? undefined : undefined;
    if (pc.os === 'linux' || pc.os === 'windows') device.os = pc.os;
    if (typeof pc.hostname === 'string' && validHostname(pc.hostname) === null) device.name = pc.hostname;
    if (typeof pc.prettyHostname === 'string') device.prettyName = pc.prettyHostname.slice(0, MAX_PRETTY);
    if (pc.files !== undefined) restoreFiles(device, validFileRecords(pc.files));
    if (pc.mode === 'dhcp') device.config = { mode: 'dhcp' };
    else device.setStatic(parseStatic(pc));
    if (device instanceof Server) device.web.reload();
    if (device instanceof Server && rec.server) restoreServer(device, rec.server);
    if (device instanceof Pc && pc.apps) restoreApps(device, pc.apps);
    if (pc.files !== undefined) bootKernel(device, validFileRecords(pc.files));
    return;
  }
  if (rec.config) applyConfig(device, rec.config);
  device.startupConfig = rec.startup ?? null;
}

function restoreApps(pc: Pc, apps: NonNullable<PcRecord['apps']>): void {
  const m = apps.mail;
  if (isObject(m) && ['name', 'address', 'incoming', 'outgoing', 'user', 'password'].every((k) => typeof m[k as keyof MailAccount] === 'string')) {
    pc.mailAccount = { ...m, protocol: m.protocol === 'IMAP' ? 'IMAP' : 'POP3' };
  }
  if (apps.inbox !== undefined) pc.inbox = [...(mailboxesFromJson({ inbox: apps.inbox }).inbox ?? [])];
  if (typeof apps.url === 'string') pc.browserUrl = apps.url.slice(0, 2048);
}

function restoreServer(server: Server, rec: ServerRecord): void {
  server.setServices(servicesFromJson(rec.services));
  const auto = isObject(rec.autostart) ? rec.autostart : {};
  for (const id of Object.keys(server.autostart) as UnitId[]) if (typeof auto[id] === 'boolean') server.autostart = { ...server.autostart, [id]: auto[id] };
  server.mailboxes.load(mailboxesFromJson(rec.mailboxes));
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
  if (!isObject(data) || (data.format !== 'netfix' && data.format !== 'netsim') || (data.version !== 1 && data.version !== FILE_VERSION)) throw new Error('No es un archivo de Netfix válido.');
  const { devices, links } = data;
  if (!Array.isArray(devices) || !Array.isArray(links)) throw new Error('Archivo incompleto: faltan dispositivos o enlaces.');
  for (const d of devices) {
    if (!isObject(d) || typeof d.id !== 'string' || !['router', 'switch', 'pc', 'server', 'cloud'].includes(String(d.kind))) throw new Error('Dispositivo no válido en el archivo.');
    if (![d.x, d.y, d.seed].every((n) => typeof n === 'number' && Number.isFinite(n)) || typeof d.label !== 'string') throw new Error(`Datos incompletos para ${d.id}.`);
    if (d.config !== undefined && (!Array.isArray(d.config) || d.config.some((l) => typeof l !== 'string'))) throw new Error(`Configuración no válida en ${d.id}.`);
  }
  for (const l of links) {
    if (!isObject(l) || !isObject(l.a) || !isObject(l.b) || [l.a.device, l.a.port, l.b.device, l.b.port].some((x) => typeof x !== 'string')) throw new Error('Enlace no válido en el archivo.');
  }
  return data as unknown as TopologyFile;
}
