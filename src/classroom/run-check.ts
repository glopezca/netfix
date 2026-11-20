/**
 * The `run` check (Codefix, D24 of FixIT Classroom): a command in a PC's or server's bash (or cmd.exe, shell 'cmd')
 * whose output must contain a text. A registered type (S23: it moves to Classroom's extension pack); the package
 * entries register it until then.
 */
import { checkFields, checkKind, registerCheckKind, type CheckOutcome, type ExtensionCheck } from './checklist.ts';
import { runOnHost } from './host-run.ts';
import type { Topology } from '../net/topology.ts';

function markRun(t: Topology, c: ExtensionCheck): CheckOutcome {
  const [device, command, contains] = [String(c.device), String(c.command), String(c.contains)];
  const r = runOnHost(t, device, c.shell === 'cmd' ? 'windows' : 'linux', command);
  if ('error' in r) return { passed: false, detail: r.error };
  const passed = r.output.join('\n').includes(contains);
  return { passed, detail: `«${command}» en «${device}» ${passed ? 'muestra' : 'no muestra'} «${contains}».` };
}

/** Registers `run` once (both package entries may call it). */
export function registerRunCheck(): void {
  if (checkKind('run')) return;
  registerCheckKind('run', {
    fields: { device: checkFields.label, 'shell?': checkFields.oneOf(['bash', 'cmd']), command: checkFields.plain, contains: checkFields.contains },
    evaluate: markRun,
  });
}
