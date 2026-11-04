/**
 * What the Services tab and the web admin do with the firewall: apply AND save (unlike `nft`, which only
 * changes the running ruleset): /etc/nftables.conf is rewritten and nftables.service enabled and started. A Server or
 * Linux router has its own firewall unit; a GNU/Linux PC has the one apt's nftables package brings (net/pkg-units.ts).
 */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { runsServices } from '../devices/kinds.ts';
import { NFTABLES_UNIT, pkgUnitState, setPkgUnitState } from '../net/pkg-units.ts';
import { reloadPkgUnit, startPkgUnit, stopPkgUnit } from './pkg-service.ts';
import type { Ruleset } from '../net/nft/model.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';
import { rulesetFile, runNft } from '../net/nft/apply.ts';
import { NFTABLES_CONF } from '../devices/server-firewall.ts';
import { hostSystem } from './host-system.ts';

export interface FirewallStatus {
  /** nftables.service active (and enabled at boot). */
  readonly active: boolean;
  readonly enabled: boolean;
  /** The running ruleset is what /etc/nftables.conf loads. */
  readonly saved: boolean;
}

/** The device's own firewall unit (Server, Linux router), or null on a PC (nftables.service of the package). */
const ownUnit = (host: Host): Server | null => (runsServices(host.kind) ? host as Server : null);

function savedRuleset(host: Host): Ruleset | null {
  const fs = hostSystem(host).fs;
  const text = fs.tryLookup(NFTABLES_CONF)?.kind === 'file' ? fs.readFile(NFTABLES_CONF) : null;
  if (text === null) return null;
  const r = runNft(EMPTY_RULESET, text, { read: (p) => (fs.tryLookup(p)?.kind === 'file' ? fs.readFile(p) : null) });
  return r.ok ? r.ruleset : null;
}

export function firewallStatus(host: Host): FirewallStatus {
  const saved = savedRuleset(host);
  const running = rulesetFile(host.kernel.netfilter.ruleset);
  const server = ownUnit(host);
  const unit = server ? { active: server.services.firewall.enabled, enabled: server.autostart.firewall } : pkgUnitState(host, NFTABLES_UNIT);
  return { active: unit.active, enabled: unit.enabled, saved: saved !== null && rulesetFile(saved) === running };
}

/** Applies `rs`, writes /etc/nftables.conf and makes sure nftables.service is enabled and running. */
export function applyAndSave(host: Host, rs: Ruleset): void {
  hostSystem(host).fs.writeFile(NFTABLES_CONF, rulesetFile(rs), undefined, false, 0o755);
  const server = ownUnit(host);
  if (server) {
    server.autostart = { ...server.autostart, firewall: true };
    if (!server.services.firewall.enabled) server.setServices({ ...server.services, firewall: { enabled: true } });
  } else {
    setPkgUnitState(host, NFTABLES_UNIT, { enabled: true });
    startPkgUnit(host, NFTABLES_UNIT);
  }
  host.kernel.netfilter.setRuleset(rs);
  host.notifyChange();
}

/** Turns nftables.service off (flushes the ruleset) or on (loads the file); keeps it enabled at boot accordingly. */
export function setFirewallActive(host: Host, on: boolean): void {
  const server = ownUnit(host);
  if (server) {
    server.autostart = { ...server.autostart, firewall: on };
    server.setServices({ ...server.services, firewall: { enabled: on } });
    return;
  }
  setPkgUnitState(host, NFTABLES_UNIT, { enabled: on });
  if (on) startPkgUnit(host, NFTABLES_UNIT);
  else stopPkgUnit(host, NFTABLES_UNIT);
  host.notifyChange();
}

/** systemctl reload nftables: the file is loaded again (null), or the nft error and the running rules stay. */
export function reloadFirewall(host: Host): string | null {
  const server = ownUnit(host);
  if (server) return server.reloadFirewall();
  const out = reloadPkgUnit(host, NFTABLES_UNIT);
  host.notifyChange();
  return out.length ? out.join('\n') : null;
}
