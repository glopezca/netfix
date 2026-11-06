/**
 * The systemd units that apt's packages bring on any GNU/Linux host, a PC too: samba's smbd and nmbd (started and
 * enabled on install, as dpkg's scripts do), on a PC nftables.service (installed stopped and disabled, Debian's
 * default; a Server or Linux router has its own firewall unit, services/units.ts), and systemd-resolved, which the base
 * system brings (running and enabled; it is not in Registros). Their state and journal live beside
 * the device in weak registries, as its packages do; the state is saved with the topology.
 */
import { hasPackage } from './host-packages.ts';
import { deviceApps, sambaAllowed } from './device-apps.ts';
import type { AppsDevice } from './device-apps.ts';
import { runsServices } from '../devices/kinds.ts';

export interface PkgUnit {
  readonly name: string;
  readonly pkg: string;
  readonly process: string;
  readonly description: string;
  readonly pid: number;
  /** Runs once and exits (nftables loads its file): «active (exited)». */
  readonly oneshot: boolean;
  readonly startOnInstall: boolean;
  /** Only where the device has no unit of its own for it. */
  readonly pcOnly: boolean;
  /** Part of the base system (its package cannot be removed): every host has it, running and enabled. */
  readonly base?: boolean;
  /** Its program, when not /usr/sbin/<process>. */
  readonly path?: string;
}

/** systemd-resolved: the system's resolver (resolvectl, the «resolve» source of nsswitch.conf, LLMNR and mDNS). */
export const RESOLVED_UNIT: PkgUnit = { name: 'systemd-resolved', pkg: 'systemd', process: 'systemd-resolved', description: 'Network Name Resolution', pid: 512, oneshot: false, startOnInstall: true, pcOnly: false, base: true, path: '/usr/lib/systemd/systemd-resolved' };

export const NFTABLES_UNIT: PkgUnit = { name: 'nftables', pkg: 'nftables', process: 'nft', description: 'nftables', pid: 655, oneshot: true, startOnInstall: false, pcOnly: true };

export const PKG_UNITS: readonly PkgUnit[] = [
  { name: 'nmbd', pkg: 'samba', process: 'nmbd', description: 'Samba NMB Daemon', pid: 1205, oneshot: false, startOnInstall: true, pcOnly: false },
  { name: 'smbd', pkg: 'samba', process: 'smbd', description: 'Samba SMB Daemon', pid: 1210, oneshot: false, startOnInstall: true, pcOnly: false },
  NFTABLES_UNIT,
  RESOLVED_UNIT,
];

export interface UnitState {
  readonly active: boolean;
  readonly enabled: boolean;
}

export interface JournalLine {
  readonly time: number;
  readonly line: string;
  /** Written by systemd itself (Starting…, Started…), not by the service. */
  readonly systemd: boolean;
}

const states = new WeakMap<object, ReadonlyMap<string, UnitState>>();
const journals = new WeakMap<object, ReadonlyMap<string, readonly JournalLine[]>>();
const MAX_JOURNAL = 200;

export function unitInstalled(d: AppsDevice, u: PkgUnit): boolean {
  return (u.base === true || hasPackage(d, u.pkg)) && !(u.pcOnly && runsServices(d.kind));
}

/** The installed unit called `name` (with or without .service). */
export function findPkgUnit(d: AppsDevice, name: string): PkgUnit | undefined {
  const bare = name.replace(/\.service$/, '');
  return PKG_UNITS.find((u) => u.name === bare && unitInstalled(d, u));
}

export function installedUnits(d: AppsDevice): PkgUnit[] {
  return PKG_UNITS.filter((u) => unitInstalled(d, u));
}

/** The units whose journal Registros shows: Samba's daemons (smbd first, as an administrator looks there), then nftables. */
export function journalUnits(d: AppsDevice): string[] {
  return ['smbd', 'nmbd', 'nftables'].filter((name) => findPkgUnit(d, name) !== undefined);
}

export function pkgUnitState(d: object, u: PkgUnit): UnitState {
  return states.get(d)?.get(u.name) ?? { active: u.startOnInstall, enabled: u.startOnInstall };
}

export function setPkgUnitState(d: object, u: PkgUnit, change: Partial<UnitState>): void {
  const next = new Map(states.get(d));
  next.set(u.name, { ...pkgUnitState(d, u), ...change });
  states.set(d, next);
}

/** The package is gone: its units start again from their defaults on the next install. */
export function forgetPkgUnits(d: object, pkg: string): void {
  const names = PKG_UNITS.filter((u) => u.pkg === pkg).map((u) => u.name);
  const keep = <T>(m: ReadonlyMap<string, T> | undefined): Map<string, T> => new Map([...(m ?? [])].filter(([k]) => !names.includes(k)));
  states.set(d, keep(states.get(d)));
  journals.set(d, keep(journals.get(d)));
}

export function pkgLog(d: object, u: PkgUnit, time: number, line: string, systemd = false): void {
  const next = new Map(journals.get(d));
  next.set(u.name, [...(next.get(u.name) ?? []), { time, line, systemd }].slice(-MAX_JOURNAL));
  journals.set(d, next);
}

export function pkgJournal(d: object, u: PkgUnit): readonly JournalLine[] {
  return journals.get(d)?.get(u.name) ?? [];
}

/** The states that differ from the defaults, of the installed units (what the file keeps). */
export function pkgUnitsRecord(d: AppsDevice): Record<string, UnitState> | undefined {
  const out: Record<string, UnitState> = {};
  for (const u of installedUnits(d)) {
    const s = pkgUnitState(d, u);
    if (s.active !== u.startOnInstall || s.enabled !== u.startOnInstall) out[u.name] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The `units` of a file (untrusted): known unit names with two booleans. */
export function restorePkgUnits(d: object, data: unknown): void {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
  for (const u of PKG_UNITS) {
    const s: unknown = (data as Record<string, unknown>)[u.name];
    if (typeof s !== 'object' || s === null) continue;
    const { active, enabled } = s as Record<string, unknown>;
    if (typeof active === 'boolean' && typeof enabled === 'boolean') setPkgUnitState(d, u, { active, enabled });
  }
}

/** The unit is installed and running (nmbd answers NetBIOS, smbd opens 139/445). */
export function unitRunning(d: AppsDevice, name: string): boolean {
  const u = findPkgUnit(d, name);
  return u !== undefined && pkgUnitState(d, u).active;
}

/** It has a GNU/Linux terminal: its own system, or the Linux terminal switched on in its Configuración tab. */
export const linuxSide = (d: AppsDevice): boolean => d.os === 'linux' || deviceApps(d).includes('linux');

/** The Configuración tab offers the Samba box: a GNU/Linux terminal, in a lab that allows Samba. */
export function sambaOffered(d: AppsDevice): boolean {
  return sambaAllowed(d) && linuxSide(d);
}

/**
 * What the packages add to the Servicios tab. A GNU/Linux PC: the kernel parameters and the configuration files
 * (always: every kernel has them), then the firewall with nftables, Samba with samba, and the logs of either. A Server
 * or Linux router has every other panel already: samba adds its own. A lab without Samba hides its panel.
 */
export function hostPanels(d: AppsDevice): string[] {
  const samba = hasPackage(d, 'samba') && sambaOffered(d);
  if (runsServices(d.kind)) return samba ? ['samba'] : [];
  if (!linuxSide(d)) return [];
  const nft = unitInstalled(d, NFTABLES_UNIT);
  return ['sysctl', ...(nft ? ['firewall'] : []), ...(samba ? ['samba'] : []), 'files', ...(nft || samba ? ['log'] : [])];
}
