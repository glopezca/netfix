/**
 * cmd.exe line syntax, without running anything: & && || chains, ( ) groups, %VAR% / %1 expansion, the arguments of a
 * batch file and set /a arithmetic. ^ escapes the next character and double quotes protect everything inside them.
 */

export type Joint = '&' | '&&' | '||';

export interface Link {
  readonly text: string;
  /** How it joins the one before: & always runs, && after a success, || after a failure. */
  readonly op: Joint;
}

/** Splits a line at & && || outside quotes and parentheses (a group runs as one piece). */
export function splitChain(line: string): Link[] {
  const links: Link[] = [];
  let quoted = false;
  let depth = 0;
  let start = 0;
  let op: Joint = '&';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '^') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (depth === 0 && (ch === '&' || (ch === '|' && line[i + 1] === '|'))) {
      links.push({ text: line.slice(start, i), op });
      const double = line[i + 1] === ch;
      op = double ? (ch === '&' ? '&&' : '||') : '&';
      if (double) i++;
      start = i + 1;
    }
  }
  links.push({ text: line.slice(start), op });
  return links;
}

/** Index of the ) closing the ( at `open` (quotes and ^ respected), or -1. */
export function closingParen(s: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '^') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Open parentheses left unclosed at the end of a line (a batch block goes on to the next lines). */
export function openParens(s: string): number {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '^') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
  }
  return depth;
}

export interface Expansion {
  /** A variable's value (any case), or undefined. */
  readonly get: (name: string) => string | undefined;
  /** In a batch file: %0-%9 and %*; %% is a %, and an unknown %NAME% is empty. */
  readonly args?: readonly string[];
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** %NAME% (and, in a batch file, %%, %0-%9, %~1, %*): what cmd.exe replaces before running a line. */
export function expandLine(line: string, x: Expansion): string {
  return line.replace(/%%|%(~?)(\d)|%\*|%([A-Za-z_][\w#$.-]*)%/g, (all, tilde: string | undefined, n: string | undefined, name: string | undefined) => {
    if (name !== undefined) return x.get(name) ?? (x.args ? '' : all);
    if (!x.args) return all;
    if (all === '%%') return '%';
    if (all === '%*') return x.args.slice(1).join(' ');
    const v = x.args[Number(n)] ?? '';
    return tilde ? unquote(v) : v;
  });
}

/** The arguments of a batch file as typed (quotes kept, as %1 shows them; %~1 removes them). */
export function batchArgs(text: string): string[] {
  return text.match(/(?:"[^"]*"?|[^\s"])+/g) ?? [];
}

// ------------------------------------------------------------ set /a

class Arith {
  private readonly tokens: string[];
  private pos = 0;
  private readonly get: (name: string) => number;

  constructor(expr: string, get: (name: string) => number) {
    this.tokens = expr.match(/\d+|[A-Za-z_]\w*|[-+*/%()]/g) ?? [];
    this.get = get;
    if (this.tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error('Missing operand.');
  }

  value(): number {
    const v = this.sum();
    if (this.pos < this.tokens.length) throw new Error('Missing operator.');
    return v;
  }

  private sum(): number {
    let v = this.product();
    while (this.tokens[this.pos] === '+' || this.tokens[this.pos] === '-') v = this.tokens[this.pos++] === '+' ? v + this.product() : v - this.product();
    return v | 0;
  }

  private product(): number {
    let v = this.unary();
    for (let op = this.tokens[this.pos]; op === '*' || op === '/' || op === '%'; op = this.tokens[this.pos]) {
      this.pos++;
      const r = this.unary();
      if (op !== '*' && r === 0) throw new Error('Divide by zero error.');
      v = op === '*' ? Math.imul(v, r) : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  }

  private unary(): number {
    const t = this.tokens[this.pos++];
    if (t === '-') return -this.unary();
    if (t === '+') return this.unary();
    if (t === '(') {
      const v = this.sum();
      if (this.tokens[this.pos++] !== ')') throw new Error('Unbalanced parenthesis.');
      return v;
    }
    if (t !== undefined && /^\d+$/.test(t)) return Number(t) | 0;
    if (t !== undefined && /^[A-Za-z_]/.test(t)) return this.get(t);
    throw new Error('Missing operand.');
  }
}

/**
 * set /a: NAME=expr, NAME+=expr (-= *= /= %=) or a bare expr, separated by commas; integers only (32 bits), variables
 * by name without %. Returns the assignments and the last value, or cmd's error message.
 */
export function arith(text: string, get: (name: string) => string | undefined): { sets: [string, string][]; last: number } | string {
  const sets: [string, string][] = [];
  // A variable set earlier on the same line counts with its new value.
  const num = (name: string): number => Number.parseInt([...sets].reverse().find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? get(name) ?? '0', 10) || 0;
  let last = 0;
  try {
    for (const part of unquote(text.trim()).split(',')) {
      const m = /^\s*([A-Za-z_]\w*)\s*([-+*/%]?)=(?!=)(.*)$/.exec(part);
      const value = new Arith(m ? (m[3] ?? '') : part, num).value();
      if (!m) { last = value; continue; }
      const name = m[1] ?? '';
      const op = m[2] ?? '';
      const cur = num(name);
      if ((op === '/' || op === '%') && value === 0) return 'Divide by zero error.';
      last = op === '+' ? cur + value : op === '-' ? cur - value : op === '*' ? Math.imul(cur, value) : op === '/' ? Math.trunc(cur / value) : op === '%' ? cur % value : value;
      sets.push([name, String(last | 0)]);
    }
  } catch (e) {
    return e instanceof Error ? e.message : 'Missing operand.';
  }
  return { sets, last };
}
