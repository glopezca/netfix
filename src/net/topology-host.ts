/** The PC and server part of a saved device: what a Host writes to the file and how it is read back. */
import type { PcRecord, ServerRecord } from './topology.ts';
import { nicsToJson, routesToJson, restoreNics, restoreRoutes } from './topology-nics.ts';
import { savedFiles, restoreFiles, bootKernel } from '../shells/host-system.ts';
import { searchList } from '../shells/netplan-model.ts';
import { validFileRecords } from '../bash/vfs-persist.ts';
import { customApps, deviceApps, parseApps, setDeviceApps } from './device-apps.ts';
import { autoPackagesOf, packagesOf, parsePackages, setPackageAuto, setPackageInstalled } from './host-packages.ts';
import { pkgUnitsRecord, restorePkgUnits } from './pkg-units.ts';
import { bootPkgUnits } from '../shells/pkg-service.ts';
import { bootWins } from '../shells/samba-wins.ts';
import { bootWindowsWins, setWindowsWins, validWins, windowsWinsManual } from './win-wins.ts';
import { restoreWinShares, winSharesRecord } from './win-shares.ts';
import type { Host } from '../devices/host.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';
import { restoreApps, restoreServer } from './topology-restore.ts';
import { parseIp, formatIp, parseMask } from '../core/ip.ts';
import { parseHexId } from '../core/mac.ts';

const MAX_PRETTY = 256;

/** The fields of a Host that go to the file (the static address only in static mode). */
export function hostRecord(d: Host): PcRecord {
  const c = d.config;
  const os = d.os;
  const clientId = d.clientIdOverride;
  const files = savedFiles(d);
  const enabled = customApps(d);
  const packages = packagesOf(d);
  const autoPackages = autoPackagesOf(d);
  const units = pkgUnitsRecord(d);
  const wins = windowsWinsManual(d);
  const winShare = winSharesRecord(d);
  const names = { ...(wins !== undefined ? { wins: formatIp(wins) } : {}), ...(winShare ? { winShare } : {}),...(enabled ? { enabled } : {}), ...(packages.length ? { packages } : {}), ...(autoPackages.length ? { autoPackages } : {}), ...(units ? { units } : {}), hostname: d.name, prettyHostname: d.prettyName, nics: nicsToJson(d), routes: routesToJson(d.staticRoutes), ...(d.dnsSearch.length ? { search: d.dnsSearch } : {}) };
  if (c.mode === 'dhcp') return { mode: 'dhcp', sendClientId: d.sendClientId, clientId, os, files, ...names };
  const opt = (n: number | undefined): string | undefined => (n === undefined ? undefined : formatIp(n));
  return { mode: 'static', ip: opt(c.ip), mask: c.prefix !== undefined ? `/${c.prefix}` : undefined, gateway: opt(c.gateway), dns: opt(c.dns), sendClientId: d.sendClientId, clientId, os, files, ...names };
}

/** Puts a saved PC or server back (the record is untrusted: every field is checked). */
export function restoreHost(device: Host, pc: PcRecord, server: ServerRecord | undefined): void {
  device.sendClientId = pc.sendClientId ?? true;
  device.clientIdOverride = typeof pc.clientId === 'string' ? parseHexId(pc.clientId) ?? undefined : undefined;
  if (pc.os === 'linux' || pc.os === 'windows') device.os = pc.os;
  setDeviceApps(device, parseApps(pc.enabled, device.kind));
  for (const name of parsePackages(pc.packages)) setPackageInstalled(device, name, true);
  for (const name of parsePackages(pc.autoPackages)) setPackageAuto(device, name, true);
  restorePkgUnits(device, pc.units);
  // The host name is not read back: it always comes from the device name (net/device-names.ts).
  if (typeof pc.prettyHostname === 'string') device.prettyName = pc.prettyHostname.slice(0, MAX_PRETTY);
  if (pc.files !== undefined) restoreFiles(device, validFileRecords(pc.files));
  if (pc.mode === 'dhcp') device.config = { mode: 'dhcp' };
  else device.setStatic(parseStatic(pc));
  const wins = typeof pc.wins === 'string' ? parseIp(pc.wins) : null;
  setWindowsWins(device, validWins(wins) ? wins : undefined);
  restoreWinShares(device, pc.winShare);
  if (device instanceof Server) device.web.reload();
  if (device instanceof Server && server) restoreServer(device, server);
  if (device instanceof Pc && pc.apps) restoreApps(device, pc.apps);
  // Files before v0.25 have no `enabled`: a PC with a mail account keeps its Correo tab.
  if (device instanceof Pc && pc.enabled === undefined && device.mailAccount) setDeviceApps(device, [...deviceApps(device), 'mail']);
  restoreNics(device, pc.nics);
  restoreRoutes(device, pc.routes);
  const search = Array.isArray(pc.search) ? searchList(pc.search) : { ok: [] };
  device.dnsSearch = 'ok' in search ? search.ok : [];
  if (pc.files !== undefined) bootKernel(device, validFileRecords(pc.files));
  bootPkgUnits(device);
}

export function parseStatic(pc: PcRecord): { ip?: number; prefix?: number; gateway?: number; dns?: number } {
  const opt = (s: string | undefined): number | undefined => (s ? parseIp(s) ?? undefined : undefined);
  return { ip: opt(pc.ip), prefix: pc.mask ? parseMask(pc.mask) ?? undefined : undefined, gateway: opt(pc.gateway), dns: opt(pc.dns) };
}

/** Once the links of a read-back lab are up: DHCP asks for a lease again, and nmbd or NetBT register with their WINS. */
export function bootLinked(device: Host): void {
  if (device.config.mode === 'dhcp') device.useDhcp();
  bootWins(device);
  bootWindowsWins(device);
}
