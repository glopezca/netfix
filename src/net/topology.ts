/** A workspace: devices with positions and labels, links, and JSON persistence. */
import { t } from '../i18n/t.ts';
import { registerPlaced, renameDevice, savedLabel, syncDeviceName } from './device-names.ts';
import { nicsToJson, routesToJson, restoreNics, restoreRoutes } from './topology-nics.ts';
import type { NicRecord, RouteRecord } from './topology-nics.ts';
import { LinuxRouter } from '../devices/linux-router.ts';
import { savedFiles, restoreFiles, bootKernel } from '../shells/host-system.ts';
import { bootWireguard } from '../shells/wg-boot.ts';
import { searchList } from '../shells/netplan-model.ts';
import { validFileRecords } from '../bash/vfs-persist.ts';
import type { FileRecord } from '../bash/vfs-persist.ts';
import { Network } from './network.ts';
import { drawable, makeAnnotation, MAX_ANNOTATIONS } from './annotations.ts';
import { FILE_VERSION, validateFile } from './topology-file.ts';
import { parseFeatures } from './lab-features.ts';
import type { LabFeatures } from './lab-features.ts';
import { bindLab, customApps, deviceApps, parseApps, setDeviceApps } from './device-apps.ts';
import type { Annotation, AnnotationInit } from './annotations.ts';
import type { CableKind, Endpoint, Link } from './network.ts';
import { SimClock } from '../core/clock.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { Pc } from '../devices/pc.ts';
import { Host } from '../devices/host.ts';
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

export type DeviceKind = 'router' | 'switch' | 'pc' | 'server' | 'linuxrouter' | 'cloud';
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
  /** Before v0.24.1 the timestamp prompt was saved per device; it is global now and the field is ignored. */
  readonly timestampPrompt?: boolean;
  /** PC apps: e-mail account, inbox and last browser URL. */
  readonly apps?: { readonly mail?: MailAccount; readonly inbox?: readonly MailMessage[]; readonly url?: string };
  /** Files created or changed from the Linux terminal (home directories, /etc, /var/www…). */
  readonly files?: readonly FileRecord[];
  /** Further NICs (Linux router) and static routes. */
  readonly nics?: readonly NicRecord[];
  readonly routes?: readonly RouteRecord[];
  /** netplan's nameservers.search (omitted when empty). */
  readonly search?: readonly string[];
  /** The device's Configuración tab (v0.25), when it differs from the defaults; untrusted until parseApps. */
  readonly enabled?: unknown;
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
  /** Drawings of the workspace (areas, lines, labels); missing in files before v0.8. */
  readonly annotations?: readonly Annotation[];
  /** Device settings of the lab that differ from the defaults (v0.24); untrusted until parseFeatures. */
  readonly features?: unknown;
  /** Configuración → Laboratorio actual: the web GUI leaves out what is off (v0.25; only when true). */
  readonly webHideOff?: unknown;
}

const PREFIX: Readonly<Record<DeviceKind, string>> = { router: 'Router', switch: 'Switch', pc: 'PC', server: 'Server', linuxrouter: 'LinuxRouter', cloud: 'Cloud' };
/** Drawing ids stay short (aN) even after a crafted file. */
const MAX_DRAWING_ID = 999_999_999;
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
  /** Drawings of the workspace (replaced, never mutated). */
  annotations: readonly Annotation[] = [];
  /** Configuración → Laboratorio actual: the device settings shown (only the differences from the defaults). */
  features: LabFeatures = {};
  /** The web GUI of servers and Linux routers leaves out (instead of greying) what is off. */
  webHideOff = false;
  private nextDrawing = 1;

  add(kind: DeviceKind, x: number, y: number, opts: { id?: string; seed?: number; label?: string } = {}): Placed {
    const id = opts.id ?? `d${this.nextId++}`;
    const seed = opts.seed ?? this.nextSeed++;
    this.nextSeed = Math.max(this.nextSeed, seed + 1);
    const label = opts.label ?? this.nextLabel(kind);
    const device = kind === 'cloud' ? this.newCloud(id, seed, label) : createDevice(kind, id, seed, this.clock, label);
    seeds.set(device, seed);
    if (device instanceof Host) bindLab(device, () => ({ features: this.features, webHideOff: this.webHideOff }));
    this.net.addDevice(device);
    const placed: Placed = { device, label, x, y };
    this.placed.set(id, placed);
    registerPlaced(placed, () => this.placed.values());
    syncDeviceName(placed);
    return placed;
  }

  private newCloud(id: string, seed: number, label: string): Cloud {
    const used = [...this.placed.values()].flatMap((p) => (p.device instanceof Cloud ? [p.device.settings.block] : []));
    return new Cloud({ id, name: label, clock: this.clock, seed, core: this.internet, block: this.internet.freeBlock(used) });
  }

  /** A file may give two clouds the same public block: the later ones move to a free block. */
  separateClouds(): void {
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

  /**
   * Puts back a device taken off with remove() (undo): the same object, so its configuration, files and tunnels
   * return (its timers kept running meanwhile). A name or public block given to another device since then is not
   * shared: the restored one takes a free one.
   */
  restorePlaced(id: string, placed: Placed): void {
    if (this.placed.has(id)) return;
    const d = placed.device;
    if ([...this.placed.values()].some((p) => p.label === placed.label)) renameDevice(placed, this.nextLabel(d.kind));
    if (d instanceof Cloud) {
      const used = [...this.placed.values()].flatMap((p) => (p.device instanceof Cloud ? [p.device.settings.block] : []));
      if (used.includes(d.settings.block)) d.setSettings({ ...d.settings, block: this.internet.freeBlock([...used, ...d.otherBlocks()]) });
      d.attach();
    }
    this.net.addDevice(d);
    this.placed.set(id, placed);
    registerPlaced(placed, () => this.placed.values());
    syncDeviceName(placed); // a device added meanwhile may have taken its host name
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

  /** Adds a drawing; undefined when it cannot be shown (a freehand dot) or the workspace already has MAX_ANNOTATIONS. */
  addAnnotation(init: AnnotationInit): Annotation | undefined {
    if (this.annotations.length >= MAX_ANNOTATIONS) return undefined;
    const a = makeAnnotation(`a${this.nextDrawing}`, init);
    if (!drawable(a)) return undefined;
    this.nextDrawing++;
    this.annotations = [...this.annotations, a];
    return a;
  }

  updateAnnotation(id: string, change: (a: Annotation) => Annotation): void {
    this.annotations = this.annotations.map((a) => (a.id === id ? { ...change(a), id } : a));
  }

  removeAnnotation(id: string): void {
    this.annotations = this.annotations.filter((a) => a.id !== id);
  }

  /** Removes every drawing (the lab areas too); returns how many there were. */
  clearAnnotations(): number {
    const n = this.annotations.length;
    if (n) this.annotations = [];
    return n;
  }

  settle(ms = SETTLE_MS): void {
    this.net.runFor(ms);
  }

  toJSON(): TopologyFile {
    const devices = [...this.placed.entries()].map(([id, p]) => record(id, p));
    const links = this.net.links.map((l) => ({ a: l.a, b: l.b, cable: l.cable }));
    const features = Object.keys(this.features).length ? { features: this.features } : {};
    const web = this.webHideOff ? { webHideOff: true } : {};
    return { format: 'netfix', version: FILE_VERSION, devices, links, ...(this.annotations.length ? { annotations: this.annotations } : {}), ...features, ...web };
  }

  static fromJSON(data: unknown): Topology {
    const file = validateFile(data);
    const topo = new Topology();
    const labels = new Set(file.devices.map((d) => d.label));
    for (const d of file.devices) {
      const placed = topo.add(d.kind, d.x, d.y, { id: d.id, seed: d.seed, label: savedLabel(d, labels) });
      restore(placed.device, d);
      const n = Number(/^d(\d+)$/.exec(d.id)?.[1] ?? 0);
      topo.nextId = Math.max(topo.nextId, n + 1);
    }
    topo.separateClouds();
    topo.annotations = file.annotations ?? [];
    topo.features = parseFeatures(file.features);
    topo.webHideOff = file.webHideOff === true;
    topo.nextDrawing = topo.annotations.reduce((n, a) => Math.max(n, Math.min(MAX_DRAWING_ID, Number(/^a(\d{1,9})$/.exec(a.id)?.[1] ?? 0)) + 1), 1);
    for (const l of file.links) topo.connect(l.a, l.b, l.cable);
    for (const p of topo.placed.values()) if (p.device instanceof Host && p.device.config.mode === 'dhcp') p.device.useDhcp();
    for (const p of topo.placed.values()) if (p.device instanceof LinuxRouter) bootWireguard(p.device);
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
  if (kind === 'linuxrouter') return new LinuxRouter(id, label, clock, seed);
  return new Pc(id, label, clock, seed);
}

export function record(id: string, p: Placed): DeviceRecord {
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
  const enabled = customApps(d);
  const names = { ...(enabled ? { enabled } : {}), hostname: d.name, prettyHostname: d.prettyName, nics: nicsToJson(d), routes: routesToJson(d.staticRoutes), ...(d.dnsSearch.length ? { search: d.dnsSearch } : {}) };
  if (c.mode === 'dhcp') return { mode: 'dhcp', sendClientId: d.sendClientId, clientId, os, files, ...names };
  const opt = (n: number | undefined): string | undefined => (n === undefined ? undefined : formatIp(n));
  return { mode: 'static', ip: opt(c.ip), mask: c.prefix !== undefined ? `/${c.prefix}` : undefined, gateway: opt(c.gateway), dns: opt(c.dns), sendClientId: d.sendClientId, clientId, os, files, ...names };
}

export function restore(device: AnyDevice, rec: DeviceRecord): void {
  if (device instanceof Cloud) {
    device.setSettings(cloudFromJson(rec.cloud, device.settings));
    return;
  }
  if (device instanceof Host) {
    const pc = rec.pc ?? { mode: 'static' as const };
    device.sendClientId = pc.sendClientId ?? true;
    device.clientIdOverride = typeof pc.clientId === 'string' ? parseHexId(pc.clientId) ?? undefined : undefined;
    if (pc.os === 'linux' || pc.os === 'windows') device.os = pc.os;
    setDeviceApps(device, parseApps(pc.enabled, device.kind));
    // The host name is not read back: it always comes from the device name (net/device-names.ts).
    if (typeof pc.prettyHostname === 'string') device.prettyName = pc.prettyHostname.slice(0, MAX_PRETTY);
    if (pc.files !== undefined) restoreFiles(device, validFileRecords(pc.files));
    if (pc.mode === 'dhcp') device.config = { mode: 'dhcp' };
    else device.setStatic(parseStatic(pc));
    if (device instanceof Server) device.web.reload();
    if (device instanceof Server && rec.server) restoreServer(device, rec.server);
    if (device instanceof Pc && pc.apps) restoreApps(device, pc.apps);
    // Files before v0.25 have no `enabled`: a PC with a mail account keeps its Correo tab.
    if (device instanceof Pc && pc.enabled === undefined && device.mailAccount) setDeviceApps(device, [...deviceApps(device), 'mail']);
    restoreNics(device, pc.nics);
    restoreRoutes(device, pc.routes);
    const search = Array.isArray(pc.search) ? searchList(pc.search) : { ok: [] };
    device.dnsSearch = 'ok' in search ? search.ok : [];
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
