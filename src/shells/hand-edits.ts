/**
 * Service files root edited by hand and the model behind Servicios (Fase 56, decision 7). As Webmin does, a change of
 * the model from the interface writes the unit's files again from the model; an edit not yet applied is lost. Applying
 * the files (a start, restart or reload that loads them) makes them the model, so only a later change rewrites them.
 * Each family remembers the model its files were edited against; starting or stopping the unit does not count.
 */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import type { UnitCheck } from '../devices/unit-checks.ts';
import type { ServerServices } from '../services/config.ts';
import { runsServices } from '../devices/kinds.ts';
import { KEA_DHCP4_CONF } from './apt-defaults.ts';

/** The files a unit reads: kea-dhcp4.conf for Kea, the files right in /etc/bind for named. */
export type Family = 'dhcp' | 'dns';

export function familyOf(path: string): Family | undefined {
  if (path === KEA_DHCP4_CONF) return 'dhcp';
  return /^\/etc\/bind\/[^/]+$/.test(path) ? 'dns' : undefined;
}

/** The part of the model the family's files are written from (whether the unit runs is not part of it). */
function fingerprint(server: Server, family: Family): string {
  if (family === 'dhcp') {
    const { enabled: _on, ...dhcp } = server.services.dhcp;
    return JSON.stringify(dhcp);
  }
  const { enabled: _on, unloaded: _unloaded, ...dns } = server.services.dns;
  return JSON.stringify(dns);
}

/** The model each family's hand-edited files go with. */
const baselines = new WeakMap<Host, Map<Family, string>>();
/** Families whose files a start or reload has just loaded into the model. */
const applying = new WeakMap<Host, Set<Family>>();
/** The services each server had when its files were last compared with them. */
const seen = new WeakMap<Host, ServerServices>();

const baselineOf = (host: Host): Map<Family, string> => {
  const m = baselines.get(host) ?? new Map<Family, string>();
  baselines.set(host, m);
  return m;
};

/** The first write of a generated file: its family goes with the model as it is now. */
export function noteEdit(host: Host, path: string): void {
  const family = familyOf(path);
  if (!family || !runsServices(host.kind)) return;
  const m = baselineOf(host);
  if (!m.has(family)) m.set(family, fingerprint(host as Server, family));
}

/** A lab just loaded: its saved files go with the model saved next to them. */
export function adoptEdits(server: Server, families: Iterable<Family>): void {
  const m = baselineOf(server);
  for (const f of families) m.set(f, fingerprint(server, f));
}

/** Writes the family's files again from the model, forgetting the edit. */
type Regenerate = (family: Family) => void;

function regenerateIfStale(server: Server, family: Family, regenerate: Regenerate): void {
  const m = baselines.get(server);
  const base = m?.get(family);
  if (base === undefined || base === fingerprint(server, family)) return;
  m?.delete(family);
  regenerate(family);
}

/**
 * A start or reload of the unit: if the model changed since the edit (Servicios changes it and starts the unit at
 * once), the files are written again first; a check that loads the files marks the family as applied.
 */
export function guardCheck(server: Server, family: Family, regenerate: Regenerate, run: () => UnitCheck): UnitCheck {
  regenerateIfStale(server, family, regenerate);
  const check = run();
  if (!check.ok || !check.apply) return check;
  const apply = check.apply;
  return {
    ...check,
    apply: (s) => {
      const set = applying.get(server) ?? new Set<Family>();
      applying.set(server, set.add(family));
      return apply(s);
    },
  };
}

/** After every change of the server: applied files become the model; any other change of the model rewrites them. */
export function followModel(server: Server, regenerate: Regenerate): void {
  const done = applying.get(server);
  // Most changes of a host (links, leases) leave its services as they were: nothing to compare.
  if (!done && seen.get(server) === server.services) return;
  seen.set(server, server.services);
  applying.delete(server);
  const m = baselines.get(server);
  for (const family of [...(m?.keys() ?? [])]) {
    if (done?.has(family)) m?.set(family, fingerprint(server, family));
    else regenerateIfStale(server, family, regenerate);
  }
}
