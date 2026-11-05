/**
 * nmbd and WINS, as it starts and stops: with `wins support = yes` it serves (net/wins.ts); with `wins server = IP…` it
 * registers its names with the first server of the list that answers (the next one when it does not), asking for
 * Samba's «max ttl» (3 days), refreshes them every 20 minutes (nameserv.h MAX_REFRESH_TIME) and releases them as it
 * stops. A host read back from a saved lab does the same once its links are up (topology-host.ts). libnss_wins asks
 * those servers before the broadcast.
 */
import type { Host } from '../devices/host.ts';
import { readHostFile } from '../devices/server-firewall.ts';
import { SMB_CONF, parseSmbConf } from '../services/smb-conf.ts';
import { setWinsServer, winsRegister, winsResolve, winsSendAll } from '../net/wins.ts';
import { WORKSTATION, nbnsResolve } from '../net/netbios.ts';
import { unitRunning } from '../net/pkg-units.ts';

/** Samba's default «max ttl»: what a client asks of its WINS server. */
export const WINS_CLIENT_TTL_S = 3 * 24 * 3600;
export const WINS_REFRESH_MS = 20 * 60_000;

/** The server the host's names are registered with. */
const registeredWith = new WeakMap<object, number>();
/** Bumped as nmbd starts or stops: an answer to an earlier run does nothing. */
const generations = new WeakMap<object, number>();
/** Hosts with a refresh timer pending: one per host, however often nmbd restarts. */
const refreshing = new WeakSet<object>();

const generation = (host: Host): number => generations.get(host) ?? 0;
const bump = (host: Host): number => {
  const g = generation(host) + 1;
  generations.set(host, g);
  return g;
};

/** Every 20 minutes the names go again to the server they are registered with; the timer ends when there is none. */
function refreshLoop(host: Host): void {
  if (refreshing.has(host)) return;
  refreshing.add(host);
  host.hooks.schedule(WINS_REFRESH_MS, () => {
    refreshing.delete(host);
    const server = registeredWith.get(host);
    if (server === undefined) return;
    winsSendAll(host, server, 'refresh', WINS_CLIENT_TTL_S);
    refreshLoop(host);
  });
}

/** Registers with the first server of the list that takes the names, and refreshes them there. */
function registerWith(host: Host, servers: readonly number[], gen: number): void {
  winsRegister(host, servers, WINS_CLIENT_TTL_S, () => generation(host) === gen, (server) => {
    if (server === undefined) return;
    registeredWith.set(host, server);
    refreshLoop(host);
  });
}

/** nmbd has just started: it serves WINS, or registers with its WINS server, as smb.conf says. */
export function nmbdStarted(host: Host): void {
  const conf = parseSmbConf(readHostFile(host, SMB_CONF) ?? '');
  const gen = bump(host);
  registeredWith.delete(host);
  setWinsServer(host, conf.winsSupport);
  if (!conf.winsSupport) registerWith(host, conf.winsServers, gen);
}

/** nmbd is stopping: its names are released with the server it registered them with, and it serves no more. */
export function nmbdStopped(host: Host): void {
  bump(host);
  const server = registeredWith.get(host);
  registeredWith.delete(host);
  setWinsServer(host, false);
  if (server !== undefined) winsSendAll(host, server, 'release', 0);
}

/** A host read back from a saved lab, once its links are up: a running nmbd starts its WINS role again. */
export function bootWins(host: Host): void {
  if (unitRunning(host, 'nmbd')) nmbdStarted(host);
}

/** libnss_wins (the `wins` of «hosts:»): the servers of `wins server`, then a broadcast to the subnet. */
export function winsLookup(host: Host, name: string): number | undefined {
  const servers = parseSmbConf(readHostFile(host, SMB_CONF) ?? '').winsServers;
  return winsResolve(host, servers, name, WORKSTATION) ?? nbnsResolve(host, name);
}
