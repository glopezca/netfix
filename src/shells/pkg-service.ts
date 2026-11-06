/**
 * What systemd does with the units apt's packages bring (net/pkg-units.ts): start, stop and reload them, and what
 * dpkg's maintainer scripts do (samba starts smbd and nmbd on install; removing a package stops its units). nftables on
 * a PC loads /etc/nftables.conf on start and flushes the ruleset on stop, as Debian's nftables.service does;
 * systemd-resolved reads /etc/systemd/resolved.conf on start; nmbd will not start with both WINS roles in smb.conf,
 * and serves WINS or registers with its WINS server as it starts (samba-wins.ts).
 */
import type { Host } from '../devices/host.ts';
import { loadNftablesConf, readHostFile } from '../devices/server-firewall.ts';
import { runsServices } from '../devices/kinds.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';
import { SMB_CONF, smbSections, winsConflict } from '../services/smb-conf.ts';
import { parseResolvedConf, resolvedStartLines, RESOLVED_CONF } from './resolved-conf.ts';
import { setResolvedConfig } from './resolved.ts';
import { nmbdStarted, nmbdStopped } from './samba-wins.ts';
import { AVAHI_CONF, parseAvahiConf } from './avahi-conf.ts';
import { setAvahiConfig } from '../net/avahi.ts';
import { PKG_UNITS, RESOLVED_UNIT, forgetPkgUnits, installedUnits, pkgLog, pkgUnitState, setPkgUnitState } from '../net/pkg-units.ts';
import type { PkgUnit } from '../net/pkg-units.ts';

export const SAMBA_VERSION = '4.22.3-Ubuntu';

const isNft = (u: PkgUnit): boolean => u.name === 'nftables';

/** The nft error lines go to the unit's journal, followed by what systemd says of a failed start. */
function logFailure(host: Host, u: PkgUnit, t: number, error: string, verb: 'start' | 'reload'): void {
  for (const line of error.split('\n')) pkgLog(host, u, t, line);
  pkgLog(host, u, t, `${u.name}.service: ${verb === 'start' ? 'Main' : 'Control'} process exited, code=exited, status=1/FAILURE`, true);
  if (verb === 'start') pkgLog(host, u, t, `${u.name}.service: Failed with result 'exit-code'.`, true);
  pkgLog(host, u, t, `Failed to ${verb} ${u.name}.service - ${u.description}.`, true);
}

/** nmbd's own check of smb.conf (nmbd.c): both WINS roles at once and it exits before it serves. */
function nmbdError(host: Host): string | null {
  const text = readHostFile(host, SMB_CONF);
  if (text === null || !winsConflict(smbSections(text).sections)) return null;
  return [`nmbd version ${SAMBA_VERSION} started.`, "ERROR: both 'wins support = true' and 'wins server = <server list>' cannot be set in the smb.conf file. nmbd aborting."].join('\n');
}

/** Why the unit's process exits as it starts (its journal lines), or null when it starts. */
const startError = (host: Host, u: PkgUnit): string | null => (isNft(u) ? loadNftablesConf(host) : u.name === 'nmbd' ? nmbdError(host) : null);

/** What the service itself logs as it starts; resolved reads resolved.conf then (and only then). */
function startLines(host: Host, u: PkgUnit): string[] {
  if (u.name === 'avahi-daemon') return avahiStartLines(host);
  if (u !== RESOLVED_UNIT) return [`${u.process} version ${SAMBA_VERSION} started.`];
  const conf = parseResolvedConf(readHostFile(host, RESOLVED_CONF) ?? '');
  setResolvedConfig(host, conf);
  return [...conf.warnings, ...resolvedStartLines(host.runtimeName().toLowerCase())];
}

/** avahi-daemon reads its file as it starts (Netfix: host-name, disable-publishing) and says the name it publishes. */
function avahiStartLines(host: Host): string[] {
  const conf = parseAvahiConf(readHostFile(host, AVAHI_CONF) ?? '');
  setAvahiConfig(host, conf);
  const name = `${conf.hostName || host.runtimeName().toLowerCase()}.local`;
  return [
    "Found user 'avahi' (UID 107) and group 'avahi' (GID 114).", 'Successfully dropped root privileges.', 'avahi-daemon 0.8 starting up.',
    'Successfully called chroot().', 'Successfully dropped remaining capabilities.',
    ...(conf.publish ? [] : ['Publishing disabled: no host name is announced.']),
    `Server startup complete. Host name is ${name}. Local service cookie is 3626245938.`,
  ];
}

/** Starts the unit (a running one is left as it is); false when its process failed (the reason is in its journal). */
export function startPkgUnit(host: Host, u: PkgUnit): boolean {
  if (pkgUnitState(host, u).active) return true;
  const t = host.clock.now();
  pkgLog(host, u, t, `Starting ${u.name}.service - ${u.description}...`, true);
  const error = startError(host, u);
  if (error !== null) {
    logFailure(host, u, t, error, 'start');
    return false;
  }
  if (!isNft(u)) for (const line of startLines(host, u)) pkgLog(host, u, t, line);
  setPkgUnitState(host, u, { active: true });
  if (u.name === 'nmbd') nmbdStarted(host);
  pkgLog(host, u, t, `${isNft(u) ? 'Finished' : 'Started'} ${u.name}.service - ${u.description}.`, true);
  return true;
}

export function stopPkgUnit(host: Host, u: PkgUnit): void {
  if (!pkgUnitState(host, u).active) return;
  const t = host.clock.now();
  pkgLog(host, u, t, `Stopping ${u.name}.service - ${u.description}...`, true);
  if (isNft(u)) host.kernel.netfilter.setRuleset(EMPTY_RULESET);
  if (u.name === 'nmbd') nmbdStopped(host);
  setPkgUnitState(host, u, { active: false });
  pkgLog(host, u, t, `${u.name}.service: Deactivated successfully.`, true);
  pkgLog(host, u, t, `Stopped ${u.name}.service - ${u.description}.`, true);
}

/** `systemctl reload`: nftables loads its file again (on error the rules in force stay); samba rereads smb.conf. */
export function reloadPkgUnit(host: Host, u: PkgUnit): string[] {
  if (!pkgUnitState(host, u).active) return [`Failed to reload ${u.name}.service: Unit ${u.name}.service is not active.`];
  const t = host.clock.now();
  pkgLog(host, u, t, `Reloading ${u.name}.service - ${u.description}...`, true);
  const error = isNft(u) ? loadNftablesConf(host) : null;
  if (error !== null) {
    logFailure(host, u, t, error, 'reload');
    return [`Job for ${u.name}.service failed because the control process exited with error code.`, `See "systemctl status ${u.name}.service" and "journalctl -xeu ${u.name}.service" for details.`];
  }
  pkgLog(host, u, t, `Reloaded ${u.name}.service - ${u.description}.`, true);
  return [];
}

/** Units this host has of the package (nftables.service of a Server or Linux router is its own: services/units.ts). */
const unitsOf = (host: Host, pkg: string): PkgUnit[] => PKG_UNITS.filter((u) => u.pkg === pkg && !(u.pcOnly && runsServices(host.kind)));

/** dpkg's postinst: samba's daemons are enabled and started (nftables is installed stopped and disabled). */
export function pkgInstalled(host: Host, pkg: string): void {
  for (const u of unitsOf(host, pkg)) {
    if (!u.startOnInstall) continue;
    setPkgUnitState(host, u, { active: false, enabled: true });
    startPkgUnit(host, u);
  }
}

/** dpkg's prerm: the package's units stop, and a later install starts from the defaults again. */
export function pkgRemoved(host: Host, pkg: string): void {
  for (const u of unitsOf(host, pkg)) stopPkgUnit(host, u);
  forgetPkgUnits(host, pkg);
}

/**
 * After the topology is read back: an active nftables.service has its file in the kernel again, and a unit whose
 * process could not start now (nftables.conf or smb.conf edited while it ran) comes back stopped.
 */
export function bootPkgUnits(host: Host): void {
  for (const u of installedUnits(host)) {
    if (pkgUnitState(host, u).active && startError(host, u) !== null) setPkgUnitState(host, u, { active: false });
    // A running avahi-daemon goes on with what its file says.
    if (u.name === 'avahi-daemon' && pkgUnitState(host, u).active) setAvahiConfig(host, parseAvahiConf(readHostFile(host, AVAHI_CONF) ?? ''));
  }
}
