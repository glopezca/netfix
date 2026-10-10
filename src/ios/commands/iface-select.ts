/** `interface` and `interface range` selection. */
import type { Cli } from '../device.ts';
import { parseIfaceName, isSubinterface } from '../interfaces.ts';

const INVALID_IFACE = '%Invalid interface type and number';

export function selectInterface(cli: Cli, text: string): void {
  const parsed = parseIfaceName(text);
  const name = parsed ? cli.device.resolveIface(parsed.full, true) : null;
  if (!name) {
    cli.out(INVALID_IFACE);
    return;
  }
  cli.session.ifaces = [name];
  cli.session.enterMode(isSubinterface(name) ? 'config-subif' : 'config-if');
}

/** Parses "fa0/1 - 24", "f0/1-4, f0/10 - 12", "g0/1 - 2". */
export function parseRange(spec: string): string[] | null {
  const names: string[] = [];
  for (const part of spec.split(',')) {
    const m = /^\s*([a-z]+)\s*(\d+\/)?(\d+)\s*(?:-\s*(\d+))?\s*$/i.exec(part);
    if (!m) return null;
    const first = Number(m[3]);
    const last = m[4] === undefined ? first : Number(m[4]);
    if (last < first) return null;
    for (let n = first; n <= last; n++) {
      const parsed = parseIfaceName(`${m[1]}${m[2] ?? ''}${n}`);
      if (!parsed) return null;
      names.push(parsed.full);
    }
  }
  return names;
}

export function selectInterfaceRange(cli: Cli, spec: string): void {
  const names = parseRange(spec);
  const resolved = names?.map((n) => cli.device.resolveIface(n, false));
  if (!resolved || resolved.length === 0 || resolved.some((n) => n === null)) {
    cli.out(INVALID_IFACE);
    return;
  }
  cli.session.ifaces = resolved as string[];
  cli.session.enterMode('config-if-range');
}
