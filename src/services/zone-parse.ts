/**
 * Lectura de archivos de zona (RFC 1035 §5) como la hace BIND 9.20 al cargar una zona: comentarios, paréntesis,
 * directivas $TTL y $ORIGIN, propietario heredado, TTL (con unidades) y clase en cualquier orden. Los mensajes son
 * los de dns_master_load y dns_rdata_fromtext; las comprobaciones de la zona ya cargada están en zone-check.ts.
 */

export interface ZoneRecord {
  /** Nombre absoluto en minúsculas, con el punto final. */
  readonly owner: string;
  readonly ttl: number;
  readonly type: string;
  /** Campos de los datos: nombres absolutos, números en decimal y textos tal como se escribieron. */
  readonly data: readonly string[];
  readonly line: number;
}

export interface ZoneLoad {
  readonly records: readonly ZoneRecord[];
  readonly warnings: readonly string[];
  /** El error que detiene la carga y el motivo que BIND repite en «loading from master file … failed: …». */
  readonly error?: { readonly line: string; readonly reason: string };
}

interface Tok { readonly text: string; readonly line: number }
interface Entry { readonly toks: readonly Tok[]; readonly inherit: boolean; readonly line: number }
interface State { origin: string; defaultTtl?: number; lastTtl?: number; lastOwner?: string; warnedTtl: boolean }

class LoadError extends Error {
  readonly line: string;
  readonly reason: string;
  constructor(line: string, reason: string) {
    super(reason);
    this.line = line;
    this.reason = reason;
  }
}

/** Nombre absoluto con punto final y en minúsculas («aula.lab» → «aula.lab.»). */
export function absolute(name: string): string {
  return name.toLowerCase().replace(/\.?$/, '.');
}

/** Nombre como lo escribe BIND en sus mensajes: sin el punto final (salvo la raíz). */
export function bare(name: string): string {
  return name === '.' ? '.' : name.replace(/\.$/, '');
}

/** ¿Está `name` dentro de la zona `apex` (ambos absolutos)? */
export function inZone(name: string, apex: string): boolean {
  return apex === '.' || name === apex || name.endsWith(`.${apex}`);
}

function relativeTo(name: string, origin: string): string {
  if (name === '@') return origin;
  const n = name.toLowerCase();
  if (n.endsWith('.')) return n;
  return origin === '.' ? `${n}.` : `${n}.${origin}`;
}

const UNIT: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
// 1h30m, 3600, 1w2d: each repeated part ends with its unit, so the match is linear (no nested backtracking).
const isTtl = (t: string): boolean => /^(?:\d+[smhdw])*\d+[smhdw]?$/i.test(t);
function ttlValue(t: string): number {
  let total = 0;
  for (const m of t.matchAll(/(\d+)([smhdw]?)/gi)) total += Number(m[1] ?? '0') * (UNIT[(m[2] || 's').toLowerCase()] ?? 1);
  return total;
}

export function isIpv4(t: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(t) && t.split('.').every((o) => Number(o) <= 255);
}

export function isIpv6(t: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(t) || t.split('::').length > 2) return false;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t)?.[1];
  if (v4 !== undefined && !isIpv4(v4)) return false;
  const text = v4 === undefined ? t : `${t.slice(0, -v4.length)}0:0`;
  const parts = text.split('::');
  const groups = parts.map((p) => (p === '' ? [] : p.split(':')));
  if (groups.some((g) => g.some((x) => !/^[0-9a-f]{1,4}$/i.test(x)))) return false;
  const n = groups.reduce((sum, g) => sum + g.length, 0);
  return parts.length === 2 ? n < 8 : n === 8;
}

/** Corta una línea en palabras; devuelve la profundidad de paréntesis al acabarla. */
function scanLine(line: string, n: number, depth: number, toks: Tok[], file: string): number {
  let cur = '';
  const flush = (): void => {
    if (cur) toks.push({ text: cur, line: n });
    cur = '';
  };
  for (let j = 0; j < line.length; j++) {
    const c = line[j] ?? '';
    if (c === ';') break;
    if (c === '"') {
      flush();
      let k = j + 1;
      while (k < line.length && line[k] !== '"') k += line[k] === '\\' ? 2 : 1;
      if (k >= line.length) throw new LoadError(`dns_master_load: ${file}:${n}: unbalanced quotes`, 'unbalanced quotes');
      toks.push({ text: line.slice(j, k + 1), line: n });
      j = k;
    } else if (c === '(' || c === ')') {
      flush();
      if (c === ')' && depth === 0) throw new LoadError(`dns_master_load: ${file}:${n}: unbalanced parentheses`, 'unbalanced parentheses');
      depth += c === '(' ? 1 : -1;
    } else if (c === ' ' || c === '\t') flush();
    else cur += c;
  }
  flush();
  return depth;
}

/** Entradas lógicas del archivo: las líneas unidas dentro de los paréntesis. */
function tokenize(text: string, file: string): Entry[] {
  const lines = text.split('\n');
  const entries: Entry[] = [];
  let toks: Tok[] = [];
  let inherit = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\r$/, '');
    if (depth === 0 && toks.length === 0) inherit = /^[ \t]/.test(line);
    depth = scanLine(line, i + 1, depth, toks, file);
    if (depth === 0 && toks.length > 0) {
      entries.push({ toks, inherit, line: i + 1 });
      toks = [];
    }
  }
  if (depth > 0) throw new LoadError(`dns_master_load: ${file}:${lines.length}: unexpected end of input`, 'unexpected end of input');
  return entries;
}

const endOfInput = (where: string): LoadError => new LoadError(`dns_master_load: ${where}: unexpected end of input`, 'unexpected end of input');

function directive(e: Entry, st: State, where: string): void {
  const word = e.toks[0]?.text ?? '';
  const d = word.toUpperCase();
  const arg = e.toks[1]?.text;
  if (d !== '$TTL' && d !== '$ORIGIN') throw new LoadError(`dns_master_load: ${where}: unknown $ directive '${word}'`, 'syntax error');
  if (arg === undefined) throw endOfInput(where);
  if (d === '$ORIGIN') {
    st.origin = relativeTo(arg, st.origin);
    return;
  }
  if (!isTtl(arg)) throw new LoadError(`dns_master_load: ${where}: ${arg}: bad ttl`, 'bad ttl');
  st.defaultTtl = ttlValue(arg);
}

type Field = 'ip4' | 'ip6' | 'name' | 'u8' | 'u16' | 'u32' | 'ttl' | 'str' | 'text';
/** Types whose data is kept as written (DNSSEC, SSHFP, TLSA…): BIND knows them, Netfix does not look inside. */
const OPAQUE = [
  'SPF', 'SSHFP', 'TLSA', 'SMIMEA', 'NAPTR', 'DS', 'CDS', 'DNSKEY', 'CDNSKEY', 'KEY', 'RRSIG', 'SIG', 'NSEC', 'NSEC3',
  'NSEC3PARAM', 'LOC', 'CERT', 'URI', 'SVCB', 'HTTPS', 'OPENPGPKEY', 'ZONEMD', 'DHCID', 'IPSECKEY', 'HIP', 'APL', 'CSYNC',
];
const RDATA: Readonly<Record<string, readonly Field[]>> = {
  A: ['ip4'], AAAA: ['ip6'], NS: ['name'], CNAME: ['name'], DNAME: ['name'], PTR: ['name'], MX: ['u16', 'name'],
  SRV: ['u16', 'u16', 'u16', 'name'], SOA: ['name', 'name', 'u32', 'ttl', 'ttl', 'ttl', 'ttl'],
  TXT: ['text'], HINFO: ['str', 'str'], CAA: ['u8', 'str', 'str'], RP: ['name', 'name'], AFSDB: ['u16', 'name'],
  KX: ['u16', 'name'], ...Object.fromEntries(OPAQUE.map((t) => [t, ['text'] as const])),
};
/** RFC 3597: TYPE65534 \# 3 abcdef. */
const fieldsOf = (type: string): readonly Field[] | undefined =>
  (Object.hasOwn(RDATA, type) ? RDATA[type] : undefined) ?? (/^TYPE\d{1,5}$/.test(type) ? ['text'] : undefined);
const MAX: Partial<Record<Field, number>> = { u8: 255, u16: 65535, u32: 4294967295 };

function field(f: Field, tok: Tok, origin: string, file: string): string {
  const bad = (reason: string): LoadError => new LoadError(`dns_rdata_fromtext: ${file}:${tok.line}: near '${tok.text}': ${reason}`, reason);
  const t = tok.text;
  if (f === 'ip4') { if (!isIpv4(t)) throw bad('bad dotted quad'); return t; }
  if (f === 'ip6') { if (!isIpv6(t)) throw bad('bad IPv6 address'); return t.toLowerCase(); }
  if (f === 'name') return relativeTo(t, origin);
  if (f === 'ttl') { if (!isTtl(t)) throw bad('not a valid number'); return String(ttlValue(t)); }
  const max = MAX[f];
  if (max !== undefined && (!/^\d+$/.test(t) || Number(t) > max)) throw bad('not a valid number');
  return t;
}

function rdata(type: string, toks: readonly Tok[], origin: string, file: string, line: number): string[] {
  const fields = fieldsOf(type) ?? [];
  const out: string[] = [];
  let i = 0;
  for (const f of fields) {
    const tok = toks[i];
    if (!tok) throw new LoadError(`dns_rdata_fromtext: ${file}:${line}: near eol: unexpected end of input`, 'unexpected end of input');
    if (f === 'text') return toks.slice(i).map((x) => x.text);
    out.push(field(f, tok, origin, file));
    i++;
  }
  const extra = toks[i];
  if (extra) throw new LoadError(`dns_rdata_fromtext: ${file}:${extra.line}: near '${extra.text}': extra input text`, 'extra input text');
  return out;
}

/** El TTL de un registro sin TTL propio: $TTL, si no el del registro anterior y, en el SOA, su mínimo. */
function ttlOf(explicit: number | undefined, type: string, data: readonly string[], st: State, where: string, warnings: string[]): number {
  if (explicit !== undefined) return (st.lastTtl = explicit);
  if (st.defaultTtl !== undefined) return st.defaultTtl;
  if (st.lastTtl !== undefined) return st.lastTtl;
  if (type !== 'SOA') throw new LoadError(`dns_master_load: ${where}: no TTL specified; zone rejected`, 'no ttl');
  if (!st.warnedTtl) warnings.push(`dns_master_load: ${where}: no TTL specified; using SOA MINTTL instead`);
  st.warnedTtl = true;
  return (st.lastTtl = Number(data[6]));
}

function record(e: Entry, st: State, file: string, warnings: string[]): ZoneRecord | undefined {
  const where = `${file}:${e.line}`;
  const first = e.toks[0]?.text ?? '';
  if (!e.inherit && first.startsWith('$')) {
    directive(e, st, where);
    return undefined;
  }
  const owner = e.inherit ? st.lastOwner : relativeTo(first, st.origin);
  if (owner === undefined) throw new LoadError(`dns_master_load: ${where}: no current owner name`, 'no owner');
  st.lastOwner = owner;
  let i = e.inherit ? 0 : 1;
  let ttl: number | undefined;
  let klass = false;
  for (let k = 0; k < 2; k++) {
    const t = e.toks[i]?.text ?? '';
    if (ttl === undefined && isTtl(t)) ttl = ttlValue(t);
    else if (!klass && t.toUpperCase() === 'IN') klass = true;
    else break;
    i++;
  }
  const typeTok = e.toks[i];
  if (!typeTok) throw endOfInput(where);
  const type = typeTok.text.toUpperCase();
  if (!fieldsOf(type)) throw new LoadError(`dns_master_load: ${where}: unknown RR type '${typeTok.text}'`, 'unknown class/type');
  const data = rdata(type, e.toks.slice(i + 1), st.origin, file, e.line);
  return { owner, ttl: ttlOf(ttl, type, data, st, where, warnings), type, data, line: e.line };
}

const SINGLETON = new Set(['SOA', 'CNAME']);

/** Reads a file named by $INCLUDE: its text, or why it could not be read («file not found»). */
export type ZoneReader = (path: string) => string | { readonly error: string };

/** The zone being loaded; records by owner make each check of `add` constant time. */
interface Load {
  readonly apex: string;
  readonly st: State;
  readonly records: ZoneRecord[];
  readonly byOwner: Map<string, ZoneRecord[]>;
  readonly warnings: string[];
  readonly read?: ZoneReader;
}

/** Añade el registro a la zona con las comprobaciones que BIND hace al cargarlo. */
function add(r: ZoneRecord, l: Load, file: string): void {
  const where = `${file}:${r.line}`;
  if (!inZone(r.owner, l.apex)) {
    l.warnings.push(`dns_master_load: ${where}: ignoring out-of-zone data (${bare(r.owner)})`);
    return;
  }
  if (r.type === 'SOA' && r.owner !== l.apex) throw new LoadError(`dns_master_load: ${where}: SOA record not at top of zone (${bare(r.owner)})`, 'not at top of zone');
  const same = l.byOwner.get(r.owner) ?? [];
  const fail = (reason: string): LoadError => new LoadError(`dns_master_load: ${where}: ${bare(r.owner)}: ${reason}`, reason);
  if (same.some((x) => (x.type === 'CNAME') !== (r.type === 'CNAME'))) throw fail('CNAME and other data');
  const twin = same.filter((x) => x.type === r.type);
  if (twin.some((x) => x.data.join(' ') === r.data.join(' '))) return;
  if (SINGLETON.has(r.type) && twin.length > 0) throw fail('multiple RRs of singleton type');
  l.records.push(r);
  l.byOwner.set(r.owner, [...same, r]);
}

/** $GENERATE 1-254 host-$ A 10.0.0.$: `$`, `${offset,width,base}` (d, o, x, X, n, N) and `\$` for a dollar. */
function substitute(template: string, n: number): string {
  return template.replace(/\\\$|\$\{(-?\d+)(?:,(\d+)(?:,([doxXnN]))?)?\}|\$/g, (m, off?: string, width?: string, base?: string) => {
    if (m === '\\$') return '$';
    const v = n + Number(off ?? 0);
    const w = Number(width ?? 0);
    if (base === 'n' || base === 'N') {
      const hex = v.toString(16).padStart(Math.ceil((w + 1) / 2), '0');
      const nibbles = [...hex].reverse().join('.');
      return base === 'N' ? nibbles.toUpperCase() : nibbles;
    }
    const text = base === 'o' ? v.toString(8) : base === 'x' ? v.toString(16) : base === 'X' ? v.toString(16).toUpperCase() : String(v);
    return text.padStart(w, '0');
  });
}

const MAX_GENERATE = 65536;

/** The records of `$GENERATE range lhs [ttl] [class] type rhs`, one entry for each value of the range. */
function generate(e: Entry, where: string): Entry[] {
  const [, range, lhs, ...rest] = e.toks;
  const rhs = rest[rest.length - 1];
  if (!range || !lhs || !rhs || rest.length < 2) throw endOfInput(where);
  const m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(range.text);
  const [start, stop, step] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3] ?? 1)];
  if (!m || start > stop || step < 1 || (stop - start) / step >= MAX_GENERATE) {
    throw new LoadError(`dns_master_load: ${where}: $GENERATE: invalid range '${range.text}'`, 'syntax error');
  }
  const out: Entry[] = [];
  for (let n = start; n <= stop; n += step) {
    const toks = [{ ...lhs, text: substitute(lhs.text, n) }, ...rest.slice(0, -1), { ...rhs, text: substitute(rhs.text, n) }];
    out.push({ toks, inherit: false, line: e.line });
  }
  return out;
}

const MAX_INCLUDE_DEPTH = 16;

/** $INCLUDE file [origin]: the records of another file; the origin of this one is the same afterwards. */
function include(l: Load, e: Entry, where: string, depth: number): void {
  const name = e.toks[1]?.text.replace(/^"(.*)"$/, '$1');
  if (name === undefined) throw endOfInput(where);
  if (depth >= MAX_INCLUDE_DEPTH) throw new LoadError(`dns_master_load: ${where}: ${name}: too many nested includes`, 'too many nested includes');
  const text = l.read?.(name) ?? { error: 'file not found' };
  if (typeof text !== 'string') throw new LoadError(`dns_master_load: ${where}: ${name}: ${text.error}`, text.error);
  const origin = l.st.origin;
  const arg = e.toks[2]?.text;
  if (arg !== undefined) l.st.origin = relativeTo(arg, origin);
  loadText(l, name, text, depth + 1);
  l.st.origin = origin;
}

function loadText(l: Load, file: string, text: string, depth: number): void {
  for (const e of tokenize(text, file)) {
    const where = `${file}:${e.line}`;
    const word = e.inherit ? '' : (e.toks[0]?.text ?? '').toUpperCase();
    if (word === '$INCLUDE') { include(l, e, where, depth); continue; }
    for (const g of word === '$GENERATE' ? generate(e, where) : [e]) {
      const r = record(g, l.st, file, l.warnings);
      if (r) add(r, l, file);
    }
  }
}

/** Carga el texto de un archivo de zona; se detiene en el primer error, como dns_master_load. */
export function loadZone(zone: string, file: string, text: string, read?: ZoneReader): ZoneLoad {
  const apex = absolute(zone);
  const l: Load = { apex, st: { origin: apex, warnedTtl: false }, records: [], byOwner: new Map(), warnings: [], read };
  try {
    loadText(l, file, text, 0);
    return { records: l.records, warnings: l.warnings };
  } catch (err) {
    if (err instanceof LoadError) return { records: l.records, warnings: l.warnings, error: { line: err.line, reason: err.reason } };
    throw err;
  }
}
