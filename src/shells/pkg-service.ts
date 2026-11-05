/**
 * What systemd does with the units apt's packages bring (net/pkg-units.ts): start, stop and reload them, and what
 * dpkg's maintainer scripts do (samba starts smbd and nmbd on install; removing a package stops its units). nftables on
 * a PC loads /etc/nftables.conf on start and flushes the ruleset on stop, as Debian's nftables.service does;
 * systemd-resolved reads /etc/systemd/resolved.conf on start.
 */
import type { Host } from '../devices/host.ts';
import { loadNftablesConf, readHostFile } from '../devices/server-firewall.ts';
import { runsServices } from '../devices/kinds.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';
import { parseResolvedConf, resolvedStartLines, RESOLVED_CONF } from './resolved-conf.ts';
import { setResolvedConfig } from './resolved.ts';
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

/** What the service itself logs as it starts; resolved reads resolved.conf then (and only then). */
function startLines(host: Host, u: PkgUnit): string[] {
  if (u !== RESOLVED_UNIT) return [`${u.process} version ${SAMBA_VERSION} started.`];
  const conf = parseResolvedConf(readHostFile(host, RESOLVED_CONF) ?? '');
  setResolvedConfig(host, conf);
  return [...conf.warnings, ...resolvedStartLines(host.runtimeName().toLowerCase())];
}

/** Starts the unit (a running one is left as it is); false when its process failed (the reason is in its journal). */
export function startPkgUnit(host: Host, u: PkgUnit): boolean {
  if (pkgUnitState(host, u).active) return true;
  const t = host.clock.now();
  pkgLog(host, u, t, `Starting ${u.name}.service - ${u.description}...`, true);
  if (isNft(u)) {
    const error = loadNftablesConf(host);
    if (error !== null) {
      logFailure(host, u, t, error, 'start');
      return false;
    }
  } else for (const line of startLines(host, u)) pkgLog(host, u, t, line);
  setPkgUnitState(host, u, { active: true });
  pkgLog(host, u, t, `${isNft(u) ? 'Finished' : 'Started'} ${u.name}.service - ${u.description}.`, true);
  return true;
}

export function stopPkgUnit(host: Host, u: PkgUnit): void {
  if (!pkgUnitState(host, u).active) return;
  const t = host.clock.now();
  pkgLog(host, u, t, `Stopping ${u.name}.service - ${u.description}...`, true);
  if (isNft(u)) host.kernel.netfilter.setRuleset(EMPTY_RULESET);
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

/** After the topology is read back: an active nftables.service has its file in the kernel again. */
export function bootPkgUnits(host: Host): void {
  for (const u of installedUnits(host)) {
    if (!isNft(u) || !pkgUnitState(host, u).active) continue;
    if (loadNftablesConf(host) !== null) setPkgUnitState(host, u, { active: false });
  }
}
