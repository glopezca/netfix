/** Base class for devices managed through the IOS CLI (routers and switches). */
import { SimClock } from '../core/clock.ts';
import type { CommandDef } from './parser.ts';
import { defaultIface, compareIfaces } from './interfaces.ts';
import type { IfaceConfig } from './interfaces.ts';
import { DEFAULT_HTTP } from './http.ts';
import type { IosHttpConfig, LocalUser } from './http.ts';

export type ModeName =
  | 'user' | 'exec' | 'config' | 'config-if' | 'config-subif' | 'config-if-range'
  | 'dhcp-config' | 'dhcp-class' | 'config-line' | 'config-vlan' | 'config-std-nacl' | 'config-ext-nacl';

export interface Cli<D extends IosDevice = IosDevice> {
  readonly device: D;
  readonly session: SessionApi;
  out(...lines: string[]): void;
}

/** The subset of Session used by command handlers (avoids an import cycle). */
export interface SessionApi {
  mode: ModeName;
  ifaces: readonly string[];
  pool: string | undefined;
  poolClass: string | undefined;
  vlan: number | undefined;
  /** Named access list being edited (`ip access-list standard NAME`). */
  acl: string | undefined;
  enterMode(mode: ModeName): void;
  runExec(line: string): void;
  requestPassword(onOk: () => void): void;
  endConfig(): void;
}

export type ModeTable<D extends IosDevice> = Partial<Record<ModeName, readonly CommandDef<Cli<D>>[]>>;

export type DeviceKind = 'router' | 'switch' | 'pc' | 'server';

export interface IfaceRuntime {
  readonly mac: string;
  readonly linkUp: boolean;
  readonly protocolUp: boolean;
}

export type ConsoleListener = (line: string) => void;

export abstract class IosDevice {
  abstract readonly kind: DeviceKind;
  abstract readonly model: string;
  hostname: string;
  enableSecret: string | undefined;
  enablePassword: string | undefined;
  bannerMotd: string | undefined;
  domainLookup = true;
  domainName: string | undefined;
  nameServers: readonly number[] = [];
  http: IosHttpConfig = DEFAULT_HTTP;
  users: readonly LocalUser[] = [];
  startupConfig: readonly string[] | null = null;
  readonly history: string[] = [];
  readonly ifaces = new Map<string, IfaceConfig>();
  clock: SimClock;
  private readonly listeners = new Set<ConsoleListener>();

  constructor(hostname: string, clock: SimClock) {
    this.hostname = hostname;
    this.clock = clock;
  }

  abstract modeTable(): ModeTable<IosDevice>;
  abstract runningConfig(): string[];
  abstract ifaceRuntime(name: string): IfaceRuntime;
  /** Called after any configuration change to an interface. */
  abstract onIfaceChanged(name: string, before: IfaceConfig | undefined): void;
  /** Resets configuration to factory defaults (used by reload / load). */
  abstract resetConfig(): void;
  /** Returns the canonical name of an existing interface, creating virtual ones when allowed. */
  abstract resolveIface(full: string, create: boolean): string | null;

  /** Address learned through `ip address dhcp`, if any (routers and switch SVIs). */
  dhcpLearned(_name: string): { ip: number; prefix: number } | undefined {
    return undefined;
  }

  /** `ip http …`: replaces the HTTP server settings and lets the device (re)open its listener. */
  setHttp(next: IosHttpConfig): void {
    this.http = next;
    this.onHttpChanged();
  }

  /** Hook for devices with a TCP stack (routers, switches). */
  protected onHttpChanged(): void {}

  /** Global settings shared by every IOS device, back to factory defaults. */
  protected resetGlobals(hostname: string): void {
    this.hostname = hostname;
    this.enableSecret = undefined;
    this.enablePassword = undefined;
    this.bannerMotd = undefined;
    this.domainLookup = true;
    this.domainName = undefined;
    this.nameServers = [];
    this.users = [];
    this.setHttp(DEFAULT_HTTP);
  }

  onConsole(listener: ConsoleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Asynchronous console messages (%LINK-5-CHANGED, debug output...). */
  log(line: string): void {
    for (const listener of this.listeners) listener(line);
  }

  iface(name: string): IfaceConfig | undefined {
    return this.ifaces.get(name);
  }

  sortedIfaceNames(): string[] {
    return [...this.ifaces.keys()].sort(compareIfaces);
  }

  addIface(name: string, opts: { shutdown: boolean; switchport: boolean }): IfaceConfig {
    const cfg = defaultIface(name, opts);
    this.ifaces.set(name, cfg);
    return cfg;
  }

  updateIface(name: string, change: (cfg: IfaceConfig) => IfaceConfig): void {
    const before = this.ifaces.get(name);
    if (!before) return;
    const after = change(before);
    this.ifaces.set(name, after);
    this.onIfaceChanged(name, before);
  }
}
