/**
 * The panels of avahi-daemon (mDNS) and winbind, done as root would do them: start or stop the unit (enabled as it
 * goes, as `systemctl enable --now`), set the name avahi publishes and whether it publishes (its file, then a
 * restart), and put «wins» in /etc/nsswitch.conf or take it out.
 */
import type { Host } from '../devices/host.ts';
import { hostSystem } from './host-system.ts';
import { startPkgUnit, stopPkgUnit } from './pkg-service.ts';
import { findPkgUnit, setPkgUnitState, unitRunning } from '../net/pkg-units.ts';
import { AVAHI_CONF, DEFAULT_AVAHI_CONF, parseAvahiConf, validAvahiName, withAvahiSettings } from './avahi-conf.ts';
import type { AvahiConfig } from '../net/avahi.ts';
import { DEFAULT_NSSWITCH, NSSWITCH, hostsSources, withWins } from './nsswitch.ts';

const read = (host: Host, path: string, fallback: string): string => {
  try { return hostSystem(host).fs.readFile(path); } catch { return fallback; }
};

/** Starts (and enables) or stops (and disables) a package's unit; false when it is not installed. */
export function setUnitRunning(host: Host, name: string, on: boolean): boolean {
  const u = findPkgUnit(host, name);
  if (!u) return false;
  setPkgUnitState(host, u, { enabled: on });
  if (on) startPkgUnit(host, u);
  else stopPkgUnit(host, u);
  host.notifyChange();
  return true;
}

export const unitOn = (host: Host, name: string): boolean => unitRunning(host, name);

/** What avahi-daemon.conf says now (what the daemon uses after its next start). */
export function avahiSettings(host: Host): AvahiConfig {
  return parseAvahiConf(read(host, AVAHI_CONF, DEFAULT_AVAHI_CONF));
}

/** Writes the settings and restarts avahi-daemon if it runs; false for a name avahi would not take. */
export function setAvahiSettings(host: Host, c: AvahiConfig): boolean {
  const hostName = c.hostName.trim();
  if (!validAvahiName(hostName)) return false;
  hostSystem(host).fs.writeFile(AVAHI_CONF, withAvahiSettings(read(host, AVAHI_CONF, DEFAULT_AVAHI_CONF), { hostName, publish: c.publish }));
  // systemctl restart: the daemon reads the file again; whether it is enabled does not change.
  const u = findPkgUnit(host, 'avahi-daemon');
  if (u && unitRunning(host, 'avahi-daemon')) {
    stopPkgUnit(host, u);
    startPkgUnit(host, u);
  }
  host.notifyChange();
  return true;
}

/** «wins» is a source of «hosts:» in nsswitch.conf. */
export function winsLookupOn(host: Host): boolean {
  return hostsSources(host).some((s) => s.source === 'wins');
}

export function setWinsLookup(host: Host, on: boolean): void {
  hostSystem(host).fs.writeFile(NSSWITCH, withWins(read(host, NSSWITCH, DEFAULT_NSSWITCH), on));
  host.notifyChange();
}
