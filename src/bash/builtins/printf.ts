/** printf formatting (builtin and /usr/bin/printf), following bash 5.3 output. */
import { strftime } from '../prompt.ts';
import { ansiQuote } from './util.ts';

export interface PrintfPass {
  /** Errors are written before the text of the same pass, as bash does. */
  readonly errors: readonly string[];
  readonly text: string;
}

export interface PrintfResult {
  readonly passes: readonly PrintfPass[];
  readonly status: number;
  /** %b met \c: stop everything. */
  readonly stopped: boolean;
}

const ESC: Readonly<Record<string, string>> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'", '?': '?' };

/** Backslash escapes; `echoMode` = %b / echo -e (\0nnn octal, \c stops). */
export function expandEscapes(s: string, echoMode: boolean): { text: string; stop: boolean } {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c !== '\\' || i + 1 >= s.length) { out += c; continue; }
    const n = s[i + 1] ?? '';
    if (n === 'c' && echoMode) return { text: out, stop: true };
    if (ESC[n] !== undefined && !(echoMode && (n === '"' || n === "'" || n === '?'))) { out += ESC[n]; i++; continue; }
    const re = echoMode ? /^(?:0([0-7]{0,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8}))/ : /^(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8}))/;
    const m = re.exec(s.slice(i + 1));
    if (!m) { out += c; continue; }
    i += m[0].length;
    if (m[1] !== undefined) out += String.fromCharCode(parseInt(m[1] || '0', 8) & 0xff);
    else out += String.fromCodePoint(parseInt(m[2] ?? m[3] ?? m[4] ?? '0', 16));
  }
  return { text: out, stop: false };
}

function parseInteger(arg: string, errors: string[]): bigint {
  const t = arg.trim();
  if (t === '') return 0n;
  if (/^['"]/.test(t)) return BigInt(t.codePointAt(1) ?? 0);
  const m = /^([+-]?)(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/.exec(t);
  if (!m) { errors.push(`${arg}: invalid number`); return 0n; }
  const body = m[2] ?? '0';
  const v = /^0[xX]/.test(body) ? BigInt(body) : body.length > 1 && body.startsWith('0') ? BigInt(`0o${body.slice(1)}`) : BigInt(body);
  if (m[0].length !== t.length) errors.push(`${arg}: invalid number`);
  return m[1] === '-' ? -v : v;
}

function parseFloatArg(arg: string, errors: string[]): number {
  const t = arg.trim();
  if (t === '') return 0;
  if (/^['"]/.test(t)) return t.codePointAt(1) ?? 0;
  const m = /^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf(?:inity)?|nan|0[xX][0-9a-fA-F]+)/i.exec(t);
  if (!m) { errors.push(`${arg}: invalid number`); return 0; }
  if (m[0].length !== t.length) errors.push(`${arg}: invalid number`);
  return Number(m[0]);
}

interface Spec {
  readonly flags: string;
  readonly width?: number;
  readonly prec?: number;
  readonly conv: string;
}

function pad(s: string, spec: Spec, numeric: boolean, integer = false): string {
  const w = spec.width ?? 0;
  if (s.length >= w) return s;
  if (spec.flags.includes('-')) return s.padEnd(w);
  if (numeric && spec.flags.includes('0') && !(integer && spec.prec !== undefined)) {
    const sign = /^[+\- ]|^0[xX]/.exec(s)?.[0] ?? '';
    return sign + s.slice(sign.length).padStart(w - sign.length, '0');
  }
  return s.padStart(w);
}

function exp(v: number, prec: number, upper: boolean): string {
  const s = v.toExponential(prec).replace(/e([+-])(\d)$/, 'e$10$2');
  return upper ? s.toUpperCase() : s;
}

function gfmt(v: number, prec: number, alt: boolean, upper: boolean): string {
  const p = prec === 0 ? 1 : prec;
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  let s = e < -4 || e >= p ? exp(v, p - 1, upper) : v.toFixed(Math.max(0, p - 1 - e));
  if (!alt) s = s.includes('e') || s.includes('E') ? s.replace(/\.?0+([eE])/, '$1') : s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return s;
}

function formatNumber(spec: Spec, arg: string, errors: string[]): string {
  const c = spec.conv;
  if ('diouxX'.includes(c)) {
    let v = parseInteger(arg, errors);
    if (c !== 'd' && c !== 'i' && v < 0n) v = BigInt.asUintN(64, v);
    let digits = c === 'o' ? v.toString(8) : c === 'x' ? v.toString(16) : c === 'X' ? v.toString(16).toUpperCase() : (v < 0n ? -v : v).toString();
    if (spec.prec !== undefined) digits = digits.padStart(spec.prec, '0');
    if (spec.flags.includes('#') && c === 'o' && !digits.startsWith('0')) digits = `0${digits}`;
    if (spec.flags.includes('#') && (c === 'x' || c === 'X') && v !== 0n) digits = `${c === 'x' ? '0x' : '0X'}${digits}`;
    const sign = v < 0n && (c === 'd' || c === 'i') ? '-' : spec.flags.includes('+') && (c === 'd' || c === 'i') ? '+' : spec.flags.includes(' ') && (c === 'd' || c === 'i') ? ' ' : '';
    return pad(sign + digits, spec, true, true);
  }
  const v = parseFloatArg(arg, errors);
  const prec = spec.prec ?? 6;
  let s: string;
  if (!Number.isFinite(v)) s = Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  else if (c === 'f' || c === 'F') s = v.toFixed(prec);
  else if (c === 'e' || c === 'E') s = exp(v, prec, c === 'E');
  else if (c === 'g' || c === 'G') s = gfmt(v, prec, spec.flags.includes('#'), c === 'G');
  else s = v.toString(16);
  if (v >= 0 && spec.flags.includes('+')) s = `+${s}`;
  else if (v >= 0 && spec.flags.includes(' ')) s = ` ${s}`;
  return pad(s, spec, true);
}

/** %q: backslash-escape shell metacharacters ($'…' for control characters). */
export function printfQuote(s: string): string {
  if (s === '') return "''";
  if (/[\x00-\x1f\x7f]/.test(s)) return ansiQuote(s);
  return s.replace(/[^A-Za-z0-9_@%+=:,./\-\u0080-￿]/g, '\\$&');
}

function convert(spec: Spec, arg: string | undefined, errors: string[], now: number, tfmt?: string): { text: string; stop: boolean } {
  const a = arg ?? '';
  switch (spec.conv) {
    case 's': return { text: pad(spec.prec !== undefined ? a.slice(0, spec.prec) : a, spec, false), stop: false };
    case 'c': return { text: pad(Array.from(a)[0] ?? '', spec, false), stop: false };
    case 'q': return { text: pad(printfQuote(a), spec, false), stop: false };
    case 'b': {
      const e = expandEscapes(a, true);
      return { text: pad(spec.prec !== undefined ? e.text.slice(0, spec.prec) : e.text, spec, false), stop: e.stop };
    }
    case 'T': {
      const secs = arg === undefined || a === '' || a === '-1' ? now : a === '-2' ? now : Number(parseInteger(a, errors)) * 1000;
      return { text: pad(strftime(tfmt ?? '%X', secs), spec, false), stop: false };
    }
    default: return { text: formatNumber(spec, arg === undefined ? (spec.conv === 's' ? '' : '0') : a, errors), stop: false };
  }
}

const SPEC = /^%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?(?:\(([^)]*)\))?([diouxXfFeEgGaAcsbqT%])/;

export function formatPrintf(fmt: string, args: readonly string[], now: number): PrintfResult {
  const passes: PrintfPass[] = [];
  let ai = 0;
  let failed = false;
  for (;;) {
    const errors: string[] = [];
    const r = onePass(fmt, args, ai, errors, now);
    passes.push({ errors, text: r.text });
    failed = failed || errors.length > 0 || r.bad;
    ai = r.next;
    if (r.stop || r.bad) return { passes, status: failed ? 1 : 0, stopped: r.stop };
    if (!r.consumed || ai >= args.length) return { passes, status: failed ? 1 : 0, stopped: false };
  }
}

function onePass(fmt: string, args: readonly string[], start: number, errors: string[], now: number): { text: string; next: number; consumed: boolean; stop: boolean; bad: boolean } {
  let out = '';
  let ai = start;
  let consumed = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i] ?? '';
    if (ch === '\\') {
      const m = /^\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|.)/s.exec(fmt.slice(i)) ?? ['\\'];
      out += expandEscapes(m[0], false).text;
      i += m[0].length - 1;
      continue;
    }
    if (ch !== '%') { out += ch; continue; }
    const m = SPEC.exec(fmt.slice(i));
    if (!m) { errors.push(`${fmt.slice(i, i + 2)}: invalid format character`); return { text: out, next: ai, consumed, stop: false, bad: true }; }
    i += m[0].length - 1;
    if (m[5] === '%') { out += '%'; continue; }
    const take = (): string | undefined => { consumed = true; return args[ai++]; };
    const width = m[2] === '*' ? Number(parseInteger(take() ?? '0', errors)) : m[2] ? Number(m[2]) : undefined;
    const prec = m[3] === '*' ? Number(parseInteger(take() ?? '0', errors)) : m[3] !== undefined ? Number(m[3] || 0) : undefined;
    const flags = (m[1] ?? '') + (width !== undefined && width < 0 ? '-' : '');
    const r = convert({ flags, width: width === undefined ? undefined : Math.abs(width), prec, conv: m[5] ?? 's' }, take(), errors, now, m[4]);
    out += r.text;
    if (r.stop) return { text: out, next: ai, consumed, stop: true, bad: false };
  }
  return { text: out, next: ai, consumed, stop: false, bad: false };
}
