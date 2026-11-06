/**
 * What a unit's start reads from the host's files before it runs (kea-dhcp4 -c, named): the shells layer owns the file
 * system and registers a check per unit when loaded, so devices never import it (no import cycle). systemctl and the
 * Services switch both start units through Server.setServices, so both take the same path.
 */
import type { Server } from './server.ts';
import type { ServerServices } from '../services/config.ts';
import type { UnitId } from '../services/units.ts';

/** A good start (with what the files change in the model), or what the program writes to its journal as it exits. */
export type UnitCheck =
  | { readonly ok: true; readonly apply?: (s: ServerServices) => ServerServices }
  | { readonly ok: false; readonly ident: string; readonly lines: readonly string[] };

const checks = new Map<UnitId, (server: Server) => UnitCheck>();

export function registerUnitCheck(id: UnitId, check: (server: Server) => UnitCheck): void {
  checks.set(id, check);
}

/** The check of a unit's start; a unit without one (or without a shell layer loaded) always starts. */
export function unitCheck(id: UnitId, server: Server): UnitCheck {
  return checks.get(id)?.(server) ?? { ok: true };
}
