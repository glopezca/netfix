/**
 * Rejects JavaScript regular expressions that backtrack exponentially — (a|aa)+, (a+)*, (\w|_)* — so that one
 * grep, sed, awk or [[ =~ ]] cannot freeze the browser tab (a single RegExp.exec cannot be interrupted).
 */

interface Group {
  /** Contains an unbounded quantifier. */
  quant: boolean;
  /** First atom of each finished alternative. */
  readonly alts: string[];
  /** First atom of the alternative being read. */
  first: string | null;
}

const ANY = '\u0000any';
const BIG_REPEAT = 10;

/** Length of the quantifier at i and whether it repeats without a (small) bound. */
function quantifier(src: string, i: number): { len: number; unbounded: boolean } {
  const c = src[i];
  if (c === '*' || c === '+') return { len: src[i + 1] === '?' ? 2 : 1, unbounded: true };
  if (c === '?') return { len: src[i + 1] === '?' ? 2 : 1, unbounded: false };
  const m = c === '{' ? /^\{(\d+)(,(\d*))?\}\??/.exec(src.slice(i)) : null;
  if (!m) return { len: 0, unbounded: false };
  const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
  return { len: m[0].length, unbounded: max > BIG_REPEAT };
}

function bracketEnd(src: string, i: number): number {
  let j = i + 1;
  if (src[j] === '^') j++;
  if (src[j] === ']') j++;
  for (; j < src.length && src[j] !== ']'; j++) if (src[j] === '\\') j++;
  return j + 1;
}

/** Alternatives that cannot start the same way: single distinct literal characters. */
function distinct(alts: readonly string[]): boolean {
  return alts.every((a) => a.length === 1) && new Set(alts).size === alts.length;
}

function groupPrefix(src: string, i: number): number {
  const m = /^\(\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>)/.exec(src.slice(i));
  return m ? m[0].length : 1;
}

export function isCatastrophic(src: string): boolean {
  const stack: Group[] = [{ quant: false, alts: [], first: null }];
  const top = (): Group => stack[stack.length - 1] as Group;
  const atom = (a: string): void => { const g = top(); if (g.first === null) g.first = a; };
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    if (c === '\\') { atom(/[A-Za-z]/.test(src[i + 1] ?? '') ? ANY : src[i + 1] ?? ''); i += 2; }
    else if (c === '[') { atom(ANY); i = bracketEnd(src, i); }
    else if (c === '(') { stack.push({ quant: false, alts: [], first: null }); i += groupPrefix(src, i); }
    else if (c === '|') { const g = top(); g.alts.push(g.first ?? ''); g.first = null; i++; }
    else if (c === ')' && stack.length > 1) {
      const g = stack.pop() as Group;
      g.alts.push(g.first ?? '');
      const q = quantifier(src, i + 1);
      if (q.unbounded && (g.quant || (g.alts.length > 1 && !distinct(g.alts)))) return true;
      if (q.unbounded || g.quant) top().quant = true;
      atom(g.alts.length === 1 ? g.alts[0] || ANY : ANY);
      i += 1 + q.len;
    } else {
      const q = quantifier(src, i);
      if (q.len) { if (q.unbounded) top().quant = true; i += q.len; continue; }
      atom(c === '.' ? ANY : c);
      i++;
    }
  }
  return false;
}
