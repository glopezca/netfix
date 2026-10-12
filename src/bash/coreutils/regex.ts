/** POSIX regular expressions (BRE/ERE, as in grep, sed, awk, expr) translated to JavaScript. */
import { isCatastrophic } from '../regex-guard.ts';

export class RegexError extends Error {}

/** Message for patterns that would backtrack exponentially in the browser. */
export const TOO_COMPLEX = 'netsim: expresión regular demasiado costosa (grupos repetidos con alternativas o cuantificadores)';

const CLASSES: Readonly<Record<string, string>> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e', word: '\\w',
};


/** Copies a bracket expression starting at i, returning the JS text and the end index. */
function bracket(p: string, i: number): [string, number] {
  let j = i + 1;
  let out = '[';
  if (p[j] === '^') { out += '^'; j++; }
  if (p[j] === ']') { out += '\\]'; j++; }
  for (; j < p.length; j++) {
    const c = p[j] ?? '';
    if (c === ']') return [`${out}]`, j + 1];
    const cls = /^\[:([a-z]+):\]/.exec(p.slice(j));
    if (cls) { out += CLASSES[cls[1] ?? ''] ?? ''; j += cls[0].length - 1; continue; }
    if (c === '\\') out += '\\\\';
    else if (c === '[' || (c === '-' && p[j + 1] === ']')) out += `\\${c}`;
    else out += c;
  }
  throw new RegexError('Unmatched [, [^, [:, [., or [=');
}

/** Basic RE → extended RE: \( \) \{ \} \| \+ \? become operators; bare ones become literals. */
export function breToEre(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] ?? '';
    if (c === '[') { const [b, end] = bracket(p, i); out += b.replace(/^\[/, '\u0000').replace(/\]$/, '\u0001'); i = end - 1; continue; }
    if (c === '\\' && i + 1 < p.length) {
      const n = p[++i] ?? '';
      out += '(){}|+?'.includes(n) ? n : `\\${n}`;
    } else if ('(){}|+?'.includes(c)) out += `\\${c}`;
    else if (c === '*' && (out === '' || out.endsWith('(') || out === '^')) out += '\\*';
    else out += c;
  }
  return out.replace(/\u0000/g, '[').replace(/\u0001/g, ']');
}

/** Extended RE → JavaScript RegExp source. */
export function ereToJs(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] ?? '';
    if (c === '[') { const [b, end] = bracket(p, i); out += b; i = end - 1; continue; }
    if (c === '\\' && i + 1 < p.length) {
      const n = p[++i] ?? '';
      if (n === '<') out += '\\b(?=\\w)';
      else if (n === '>') out += '\\b(?<=\\w)';
      else if (n === '`') out += '^';
      else if (n === "'") out += '$';
      else out += `\\${n}`;
      continue;
    }
    if (c === '{' && !/^\{\d*(,\d*)?\}/.test(p.slice(i))) { out += '\\{'; continue; }
    out += c;
  }
  return out;
}

export interface RegexOpts {
  readonly extended?: boolean;
  readonly fixed?: boolean;
  readonly perl?: boolean;
  readonly icase?: boolean;
  readonly global?: boolean;
  readonly word?: boolean;
  readonly line?: boolean;
}

export function compile(pattern: string, o: RegexOpts = {}): RegExp {
  let src = o.fixed ? pattern.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : o.perl ? pattern : ereToJs(o.extended ? pattern : breToEre(pattern));
  if (isCatastrophic(src)) throw new RegexError(TOO_COMPLEX);
  if (o.word) src = `(?<![\\w])(?:${src})(?![\\w])`;
  if (o.line) src = `^(?:${src})$`;
  try {
    return new RegExp(src, `${o.global ? 'g' : ''}${o.icase ? 'i' : ''}`);
  } catch (e) {
    throw new RegexError(/Unterminated group|Unmatched/.test(String(e)) ? 'Unmatched ( or \\(' : /Nothing to repeat/.test(String(e)) ? 'Invalid preceding regular expression' : 'Invalid regular expression');
  }
}
