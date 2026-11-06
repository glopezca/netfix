/**
 * What a unit's start reads from the host's files before it runs (kea-dhcp4 -c, named): the shells layer owns the file
 * system and registers a check per unit when loaded, so devices never import it (no import cycle). systemctl and the
 * Services switch both start units through Server.setServices, so both take the same path.
 */
import type { Server } from './server.ts';
import type { ServerServices } from '../services/config.ts';
import type { UnitId } from '../services/units.ts';

/**
 * A good start or reload (with what the files change in the model and what the program writes as it loads them), or
 * what the program writes to its journal as it fails.
 */
export type UnitCheck =
  | { readonly ok: true; readonly apply?: (s: ServerServices) => ServerServices; readonly ident?: string; readonly lines?: readonly string[] }
  | { readonly ok: false; readonly ident: string; readonly lines: readonly string[] };

/** A start reads the files from scratch; a reload (rndc reload) keeps what the program had when a part fails. */
export type CheckMode = 'start' | 'reload';

const checks = new Map<UnitId, (server: Server, mode: CheckMode) => UnitCheck>();

export function registerUnitCheck(id: UnitId, check: (server: Server, mode: CheckMode) => UnitCheck): void {
  checks.set(id, check);
}

/** The check of a unit's start or reload; a unit without one (or without a shell layer loaded) always loads. */
export function unitCheck(id: UnitId, server: Server, mode: CheckMode = 'start'): UnitCheck {
  return checks.get(id)?.(server, mode) ?? { ok: true };
}
