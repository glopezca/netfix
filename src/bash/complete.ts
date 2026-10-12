/** Tab completion: commands in command position, $variables, ~ and file names elsewhere. */
import type { Interp } from './interp.ts';
import { normalize } from './vfs.ts';

export interface Completion {
  /** The line with the completion applied (unchanged when ambiguous). */
  readonly line: string;
  /** Every candidate, shown on a second Tab when there is more than one. */
  readonly candidates: readonly string[];
}

const COMMAND_SEPARATORS = /(?:^|[;&|(]|&&|\|\||\bthen|\bdo|\belse|\bsudo|\btime|\b!)\s*$/;

function commonPrefix(list: readonly string[]): string {
  if (!list.length) return '';
  let p = list[0] ?? '';
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

function fileCandidates(sh: Interp, word: string): { name: string; dir: boolean }[] {
  const home = sh.getVar('HOME') ?? '/';
  const expanded = word.startsWith('~/') ? home + word.slice(1) : word === '~' ? `${home}/` : word;
  const slash = expanded.lastIndexOf('/');
  const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : '';
  const base = slash >= 0 ? expanded.slice(slash + 1) : expanded;
  const shownDir = word.startsWith('~') ? `~${dirPart.slice(home.length)}` : dirPart;
  let names: string[];
  try {
    names = sh.env.fs.readdir(normalize(dirPart || '.', sh.cwd), sh.cred);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')))
    .map((n) => ({ name: shownDir + n, dir: sh.env.fs.tryLookup(normalize(n, normalize(dirPart || '.', sh.cwd)), sh.cred)?.kind === 'dir' }));
}

export function complete(sh: Interp, line: string): Completion {
  const m = /(\S*)$/.exec(line);
  const word = m?.[1] ?? '';
  const before = line.slice(0, line.length - word.length);
  const finish = (cands: { name: string; dir: boolean }[], prefix = ''): Completion => {
    const names = [...new Set(cands.map((c) => prefix + c.name))].sort();
    if (!names.length) return { line, candidates: [] };
    if (names.length === 1) {
      const only = cands[0];
      return { line: before + (names[0] ?? '') + (only?.dir ? '/' : ' '), candidates: names };
    }
    const common = commonPrefix(names);
    return { line: before + (common.length > word.length ? common : word), candidates: names };
  };
  if (word.startsWith('$')) {
    const brace = word.startsWith('${');
    const stem = word.slice(brace ? 2 : 1);
    return finish(sh.vars.visible().map(([k]) => k).filter((k) => k.startsWith(stem)).map((k) => ({ name: k, dir: false })), brace ? '${' : '$');
  }
  if (COMMAND_SEPARATORS.test(before) && !word.includes('/')) {
    return finish(sh.commandNames().filter((c) => c.startsWith(word)).map((c) => ({ name: c, dir: false })));
  }
  return finish(fileCandidates(sh, word));
}
