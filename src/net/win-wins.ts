/**
 * NetBT on Windows with a WINS server (h-node): the server of the TCP/IP tab, or else those of the DHCP lease (option
 * 44). Windows registers its names with it when the WINS is set, when its address changes (only then, so a busy host
 * does not flood the server) and when a saved lab is read back, asking for a TTL of 300 000 s, and refreshes them at
 * half the TTL the server granted. Name queries go to the WINS before LLMNR and the broadcast (win-names.ts).
 */
import type { Host } from '../devices/host.ts';
import { winsRegister, winsSend, winsSendAll } from './wins.ts';
import { FILE_SERVER, netbiosName } from './netbios.ts';
import { winShareActive } from './win-shares.ts';
import { onAppsChange } from './device-apps.ts';

/** What Windows asks for in a registration (0x493E0 seconds). */
export const WINDOWS_WINS_TTL_S = 300_000;
const MULTICAST = 0xe0000000;

const manual = new WeakMap<object, number>();
/** «address>servers» the names were last registered for: nothing is sent again while it stays the same. */
const registeredFor = new WeakMap<object, string>();
const generations = new WeakMap<object, number>();
/** The server and granted TTL to refresh with, and the hosts with that timer pending (one each, however often they register). */
const current = new WeakMap<object, { readonly server: number; readonly ttlS: number }>();
const pending = new WeakSet<object>();
/** Whether NAME<20> went with the names (sharing on when they were registered, or since). */
const sharedFor = new WeakMap<object, boolean>();
/** The hosts of a workspace, by themselves: what a change of the Configuración tab (device-apps.ts) is about. */
const attached = new WeakMap<object, Host>();
/** NetBT keeps a primary and a secondary WINS server (what ipconfig /all shows): any more in the lease are left out. */
const MAX_SERVERS = 2;

/** A unicast address that can be a WINS server (not 0.0.0.0, broadcast or multicast). */
export const validWins = (ip: number | null | undefined): ip is number => typeof ip === 'number' && ip > 0 && ip < MULTICAST;

/** The WINS server typed in the TCP/IP tab. */
export const windowsWinsManual = (host: Host): number | undefined => manual.get(host);

/** The servers NetBT uses: the one typed in, or else those of the lease. */
export function windowsWinsServers(host: Host): readonly number[] {
  const own = manual.get(host);
  if (own !== undefined) return [own];
  return host.config.mode === 'dhcp' ? (host.dhcpClient.lease?.winsServers ?? []).filter(validWins).slice(0, MAX_SERVERS) : [];
}

const bump = (host: Host): number => {
  const g = (generations.get(host) ?? 0) + 1;
  generations.set(host, g);
  return g;
};

/** At half the granted TTL the names go again to the server they were registered with; with none, the timer ends. */
function refreshLater(host: Host): void {
  const now = current.get(host);
  if (!now || pending.has(host)) return;
  pending.add(host);
  host.hooks.schedule((now.ttlS * 1000) / 2, () => {
    pending.delete(host);
    const c = current.get(host);
    if (!c) return;
    winsSendAll(host, c.server, 'refresh', WINDOWS_WINS_TTL_S);
    refreshLater(host);
  });
}

/** Registers the names when the address or the servers changed since the last time (a Windows host with both). */
export function checkWindowsWins(host: Host): void {
  const ip = host.config.ip;
  const servers = windowsWinsServers(host);
  const key = host.os === 'windows' && ip !== undefined && servers.length ? `${ip}>${servers.join(',')}` : '';
  if (key === (registeredFor.get(host) ?? '')) return;
  registeredFor.set(host, key);
  current.delete(host);
  const gen = bump(host);
  sharedFor.set(host, winShareActive(host));
  if (!key) return;
  winsRegister(host, servers, WINDOWS_WINS_TTL_S, () => generations.get(host) === gen, (server, ttlS) => {
    if (server === undefined) return;
    current.set(host, { server, ttlS });
    refreshLater(host);
  });
}

/** The WINS server of the TCP/IP tab (undefined: none); false, and nothing changes, when it is not a unicast address. */
export function setWindowsWins(host: Host, ip: number | undefined): boolean {
  if (ip !== undefined && !validWins(ip)) return false;
  if (ip === undefined) manual.delete(host);
  else manual.set(host, ip);
  checkWindowsWins(host);
  return true;
}

/** File and printer sharing turned on or off: NAME<20> registered or released with the server the names are with. */
function sharingChanged(host: Host): void {
  const on = winShareActive(host);
  if (on === (sharedFor.get(host) ?? false)) return;
  sharedFor.set(host, on);
  const c = current.get(host);
  if (!c) return;
  const name = { name: netbiosName(host.runtimeName()), suffix: FILE_SERVER, group: false };
  winsSend(host, c.server, on ? 'registration' : 'release', name, on ? WINDOWS_WINS_TTL_S : 0);
}

let watching = false;

/** A new host in the workspace: every change of its configuration may bring a new address or lease to register, and
 * of its Configuración tab, its sharing box. */
export function attachWindowsWins(host: Host): void {
  host.onChange(() => checkWindowsWins(host));
  attached.set(host, host);
  if (watching) return;
  watching = true;
  onAppsChange((d) => {
    const h = attached.get(d);
    if (h) sharingChanged(h);
  });
}

/** A host read back from a saved lab, once its links are up: it registers again. */
export function bootWindowsWins(host: Host): void {
  registeredFor.delete(host);
  checkWindowsWins(host);
}
