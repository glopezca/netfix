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
import { setWinsServer, winsAsk, winsSend, winsSendAll } from '../net/wins.ts';
import { WORKSTATION, nbnsResolve, ownNames } from '../net/netbios.ts';
import { unitRunning } from '../net/pkg-units.ts';

/** Samba's default «max ttl»: what a client asks of its WINS server. */
export const WINS_CLIENT_TTL_S = 3 * 24 * 3600;
export const WINS_REFRESH_MS = 20 * 60_000;

/** The server the host's names are registered with. */
const registeredWith = new WeakMap<object, number>();
/** Bumped as nmbd starts or stops: a timer of an earlier run does nothing. */
const generations = new WeakMap<object, number>();

const generation = (host: Host): number => generations.get(host) ?? 0;
const bump = (host: Host): number => {
  const g = generation(host) + 1;
  generations.set(host, g);
  return g;
};

function refreshLoop(host: Host, gen: number): void {
  host.hooks.schedule(WINS_REFRESH_MS, () => {
    const server = registeredWith.get(host);
    if (generation(host) !== gen || server === undefined) return;
    winsSendAll(host, server, 'refresh', WINS_CLIENT_TTL_S);
    refreshLoop(host, gen);
  });
}

/** The first name goes to each server in turn until one answers; then the others follow it there. */
function registerWith(host: Host, servers: readonly number[], gen: number): void {
  const [server, ...rest] = servers;
  const [first, ...others] = ownNames(host);
  if (server === undefined || first === undefined) return;
  winsSend(host, server, 'registration', first, WINS_CLIENT_TTL_S, (m) => {
    if (generation(host) !== gen) return;
    if (m === undefined) return registerWith(host, rest, gen);
    registeredWith.set(host, server);
    for (const n of others) winsSend(host, server, 'registration', n, WINS_CLIENT_TTL_S);
    refreshLoop(host, gen);
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

/** A group name's address in WINS: not one host's. */
const GROUP_ADDRESS = 0xffffffff;

/**
 * libnss_wins (the `wins` of «hosts:»): the servers of `wins server`, in order, until one answers (a negative answer
 * ends there), then a broadcast to the subnet.
 */
export function winsLookup(host: Host, name: string): number | undefined {
  for (const server of parseSmbConf(readHostFile(host, SMB_CONF) ?? '').winsServers) {
    const r = winsAsk(host, server, name, WORKSTATION);
    if (r === undefined) continue;
    const ip = (r.rcode ?? 0) === 0 ? r.addresses?.[0] : undefined;
    if (ip !== undefined && ip !== GROUP_ADDRESS) return ip;
    break;
  }
  return nbnsResolve(host, name);
}
