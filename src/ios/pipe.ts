/**
 * Output modifiers of `show` commands: `| include`, `| exclude`, `| begin`, `| section`.
 * Keywords accept IOS abbreviations (`i`, `inc`, `e`, `b`, `sec`); the argument is a
 * regular expression with the IOS `_` delimiter; invalid or catastrophic patterns
 * (nested quantifiers) are matched literally so the simulator never hangs.
 */

export type PipeFilter = 'include' | 'exclude' | 'begin' | 'section';

export interface PipeSplit {
  readonly command: string;
  /** Undefined when the keyword after `|` is not a known filter. */
  readonly filter: PipeFilter | undefined;
  readonly regex: string;
  /** Position of the filter keyword in the line (for the `^` marker). */
  readonly offset: number;
}

const FILTERS: readonly PipeFilter[] = ['include', 'exclude', 'begin', 'section'];

/** Splits `cmd | filter regex`; null when the line has no pipe. */
export function splitPipe(line: string): PipeSplit | null {
  const bar = line.indexOf('|');
  if (bar < 0) return null;
  const command = line.slice(0, bar).trimEnd();
  const afterBar = line.slice(bar + 1);
  const lead = afterBar.length - afterBar.trimStart().length;
  const offset = bar + 1 + lead;
  const m = /^(\S+)\s*(.*)$/.exec(afterBar.trimStart());
  const word = (m?.[1] ?? '').toLowerCase();
  const filter = word ? FILTERS.find((f) => f.startsWith(word)) : undefined;
  return { command, filter, regex: (m?.[2] ?? '').trim(), offset };
}

/** IOS `_` matches a delimiter: comma, braces, parentheses, space, start or end of line. */
const IOS_UNDERSCORE = '(?:^|$|[,{}()\\s])';
/** A quantified group that is quantified again, e.g. `(a+)+`: catastrophic backtracking. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

function matcher(regex: string): (line: string) => boolean {
  const literal = (line: string): boolean => line.includes(regex);
  if (NESTED_QUANTIFIER.test(regex)) return literal;
  try {
    const re = new RegExp(regex.replace(/(\\.)|_/g, (m, escaped?: string) => escaped ?? IOS_UNDERSCORE));
    return (line) => re.test(line);
  } catch {
    return literal;
  }
}

/** Groups lines into sections: a line without indentation followed by its indented children. */
function sections(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last && /^\s/.test(line)) last.push(line);
    else out.push([line]);
  }
  return out;
}

export function applyFilter(lines: readonly string[], filter: PipeFilter, regex: string): string[] {
  const hit = matcher(regex);
  switch (filter) {
    case 'include':
      return lines.filter(hit);
    case 'exclude':
      return lines.filter((l) => !hit(l));
    case 'begin': {
      const first = lines.findIndex(hit);
      return first < 0 ? [] : lines.slice(first);
    }
    case 'section':
      return sections(lines).filter((block) => block.some(hit)).flat();
  }
}

const FILTER_HELP: Readonly<Record<PipeFilter, string>> = {
  begin: 'Begin with the line that matches',
  exclude: 'Exclude lines that match',
  include: 'Include lines that match',
  section: 'Filter a section of output',
};

/** `?` after the bar: filter keywords, or the regular expression placeholder. */
export function pipeHelp(afterBar: string): string[] {
  const text = afterBar.trimStart();
  if (/^\S+\s/.test(text)) return ['  LINE  Regular Expression'];
  const word = text.toLowerCase();
  const names = (Object.keys(FILTER_HELP) as PipeFilter[]).sort().filter((f) => f.startsWith(word));
  if (names.length === 0) return ['% Unrecognized command'];
  const width = Math.max(...names.map((f) => f.length)) + 2;
  return names.map((f) => `  ${f.padEnd(width)}${FILTER_HELP[f]}`);
}

/** Adds the `|` entry in front of `<cr>` in the help of a complete `show` command. */
export function withPipeEntry(help: readonly string[]): string[] {
  const cr = help.indexOf('  <cr>');
  if (cr < 0) return [...help];
  const width = Math.max(1, ...help.filter((l) => l !== '  <cr>').map((l) => (/^ {2}(\S+)/.exec(l)?.[1]?.length ?? 0)));
  return [...help.slice(0, cr), `  ${'|'.padEnd(width + 2)}Output modifiers`, ...help.slice(cr)];
}
