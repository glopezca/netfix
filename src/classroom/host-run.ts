/**
 * Runs a command line in a host's own terminal (its default user, from its home folder), as a check or a tool needs:
 * the lines it prints, or why it could not run. Generic, for registered check types (extension packs) too.
 */
import { Host, type HostOs } from '../devices/host.ts';
import { createShell } from '../shells/factory.ts';
import type { Topology } from '../net/topology.ts';

export type HostRun = { readonly output: readonly string[] } | { readonly error: string };

export function runOnHost(t: Topology, label: string, os: HostOs, line: string): HostRun {
  const found = [...t.placed.values()].filter((p) => p.label === label);
  if (found.length > 1) return { error: `Hay varios equipos llamados «${label}».` };
  const d = found[0]?.device;
  if (!d) return { error: `No existe el equipo «${label}».` };
  if (!(d instanceof Host)) return { error: `«${label}» no es un PC ni un servidor.` };
  const sh = createShell(d, os);
  sh.prompt();
  return { output: sh.run(line) };
}
