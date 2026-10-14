/**
 * What the Services tab and the web admin do with the firewall: apply AND save (unlike `nft`, which only
 * changes the running ruleset): /etc/nftables.conf is rewritten and nftables.service enabled and started.
 */
import type { Server } from '../devices/server.ts';
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

function savedRuleset(server: Server): Ruleset | null {
  const fs = hostSystem(server).fs;
  const text = fs.tryLookup(NFTABLES_CONF)?.kind === 'file' ? fs.readFile(NFTABLES_CONF) : null;
  if (text === null) return null;
  const r = runNft(EMPTY_RULESET, text, { read: (p) => (fs.tryLookup(p)?.kind === 'file' ? fs.readFile(p) : null) });
  return r.ok ? r.ruleset : null;
}

export function firewallStatus(server: Server): FirewallStatus {
  const saved = savedRuleset(server);
  const running = rulesetFile(server.kernel.netfilter.ruleset);
  return {
    active: server.services.firewall.enabled,
    enabled: server.autostart.firewall,
    saved: saved !== null && rulesetFile(saved) === running,
  };
}

/** Applies `rs`, writes /etc/nftables.conf and makes sure nftables.service is enabled and running. */
export function applyAndSave(server: Server, rs: Ruleset): void {
  hostSystem(server).fs.writeFile(NFTABLES_CONF, rulesetFile(rs), undefined, false, 0o755);
  server.autostart = { ...server.autostart, firewall: true };
  if (!server.services.firewall.enabled) server.setServices({ ...server.services, firewall: { enabled: true } });
  server.kernel.netfilter.setRuleset(rs);
  server.notifyChange();
}

/** Turns nftables.service off (flushes the ruleset) or on (loads the file); keeps it enabled at boot accordingly. */
export function setFirewallActive(server: Server, on: boolean): void {
  server.autostart = { ...server.autostart, firewall: on };
  server.setServices({ ...server.services, firewall: { enabled: on } });
}
