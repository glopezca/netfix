/**
 * Lectura de named.conf como la hace el analizador de BIND 9.20 (lib/isccfg): palabras, cadenas, los signos { } ; !,
 * los tres tipos de comentario e `include "archivo";` en cualquier punto. Aquí están el léxico y los tipos de valor
 * (booleano, duración, lista de direcciones…); la gramática de cada sentencia está en named-conf-check.ts. Los mensajes
 * son los de cfg_parser_error: «ARCHIVO:LÍNEA: missing ';' before 'x'», «… near 'x'».
 */
import { isIpv4, isIpv6 } from './zone-parse.ts';

/** Lee un archivo: su texto o el motivo por el que no se pudo («file not found», «permission denied»). */
export type ConfReader = (path: string) => string | { readonly error: string };

export interface Tok {
  readonly text: string;
  readonly kind: 'word' | 'string' | 'punct' | 'eof';
  readonly file: string;
  readonly line: number;
}

export class ConfError extends Error {}

const PUNCT = new Set(['{', '}', ';', '!']);
const WORD_END = /[\s{};!"#]/;
const MAX_INCLUDE_DEPTH = 16;
/** Files read in all: `include "x"; include "x";` inside x itself would otherwise read 2^16 files. */
const MAX_INCLUDES = 256;
/** `{ { { … } } }` in an address match list (each level is a nested call). */
const MAX_AML_DEPTH = 64;

/** Una cadena entre comillas desde `i` (la comilla de apertura); devuelve su texto, dónde sigue y las líneas que ocupa. */
function quoted(text: string, i: number, file: string, line: number): { text: string; next: number; lines: number } {
  let s = '';
  let lines = 0;
  let k = i + 1;
  while (k < text.length && text[k] !== '"') {
    if (text[k] === '\\' && k + 1 < text.length) k++;
    if (text[k] === '\n') lines++;
    s += text[k] ?? '';
    k++;
  }
  if (k >= text.length) throw new ConfError(`${file}:${line + lines}: unexpected end of input`);
  return { text: s, next: k + 1, lines };
}

/** Las piezas de un archivo; la última es el fin de archivo, en la línea que sigue al último salto. */
export function lex(text: string, file: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    const two = text.slice(i, i + 2);
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (two === '//' || c === '#') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      line += (text.slice(i, stop).match(/\n/g) ?? []).length;
      if (end < 0) throw new ConfError(`${file}:${line}: unexpected end of input`);
      i = stop;
    } else if (c === '"') {
      const q = quoted(text, i, file, line);
      toks.push({ text: q.text, kind: 'string', file, line });
      line += q.lines;
      i = q.next;
    } else if (PUNCT.has(c)) {
      toks.push({ text: c, kind: 'punct', file, line });
      i++;
    } else {
      let k = i;
      while (k < text.length && !WORD_END.test(text[k] ?? '') && !['//', '/*'].includes(text.slice(k, k + 2))) k++;
      toks.push({ text: text.slice(i, k), kind: 'word', file, line });
      i = k;
    }
  }
  toks.push({ text: '', kind: 'eof', file, line });
  return toks;
}

export const near = (t: Tok): string => (t.kind === 'eof' ? 'end of file' : `'${t.text}'`);
export const fail = (t: Tok, message: string): ConfError => new ConfError(`${t.file}:${t.line}: ${message}`);
const is = (t: Tok, punct: string): boolean => t.kind === 'punct' && t.text === punct;

interface Frame { readonly toks: readonly Tok[]; i: number }

/** Las piezas en orden, con los `include` ya sustituidos por las del archivo incluido. */
export class Stream {
  private readonly frames: Frame[];
  private readonly read: ConfReader;
  /** Piezas consumidas: ordena los errores de varios archivos como aparecen. */
  taken = 0;
  private includes = 0;

  constructor(toks: readonly Tok[], read: ConfReader) {
    this.frames = [{ toks, i: 0 }];
    this.read = read;
  }

  peek(): Tok {
    for (;;) {
      const f = this.top();
      const t = f.toks[f.i] ?? f.toks[f.toks.length - 1];
      if (!t) throw new ConfError('none:0: unexpected end of input');
      if (t.kind === 'eof' && this.frames.length > 1) this.frames.pop();
      else if (t.kind === 'word' && t.text === 'include') this.include(f, t);
      else return t;
    }
  }

  next(): Tok {
    const t = this.peek();
    if (t.kind !== 'eof') this.top().i++;
    this.taken++;
    return t;
  }

  private top(): Frame {
    const f = this.frames[this.frames.length - 1];
    if (!f) throw new ConfError('none:0: unexpected end of input');
    return f;
  }

  private include(f: Frame, t: Tok): void {
    const name = f.toks[f.i + 1] ?? t;
    if (name.kind !== 'string' && name.kind !== 'word') throw fail(name, `expected quoted string near ${near(name)}`);
    const semi = f.toks[f.i + 2] ?? name;
    if (!is(semi, ';')) throw fail(semi, `missing ';' before ${near(semi)}`);
    f.i += 3;
    if (this.frames.length >= MAX_INCLUDE_DEPTH) throw fail(t, `${name.text}: too many nested includes`);
    if (++this.includes > MAX_INCLUDES) throw fail(t, `${name.text}: too many includes`);
    const text = this.read(name.text);
    if (typeof text !== 'string') throw fail(t, `open: ${name.text}: ${text.error}`);
    this.frames.push({ toks: lex(text, name.text), i: 0 });
  }
}

/** Un nombre de ACL usado en una lista de direcciones: se comprueba al final, cuando se conocen todas. */
export interface AclRef { readonly name: string; readonly tok: Tok; readonly seq: number }
export interface Ctx { readonly s: Stream; readonly refs: AclRef[] }
/** Lee un valor; devuelve su texto cuando lo necesita la comprobación (archivo, tipo, directorio). */
export type Value = (c: Ctx) => string | undefined;

export function semicolon(s: Stream): void {
  const t = s.peek();
  if (!is(t, ';')) throw fail(t, `missing ';' before ${near(t)}`);
  s.next();
}

function open(s: Stream): void {
  const t = s.next();
  if (!is(t, '{')) throw fail(t, `'{' expected near ${near(t)}`);
}

/** Lee las entradas de un bloque hasta su `}`; cada una acaba en `;`. */
function items(c: Ctx, item: (c: Ctx) => void): void {
  open(c.s);
  for (;;) {
    const t = c.s.peek();
    if (is(t, '}')) { c.s.next(); return; }
    if (t.kind === 'eof') throw fail(t, 'unexpected end of input');
    item(c);
    semicolon(c.s);
  }
}

const word = (s: Stream): Tok => {
  const t = s.next();
  if (t.kind === 'eof') throw fail(t, 'unexpected end of input');
  return t;
};

export const bool: Value = (c) => {
  const t = word(c.s);
  if (t.kind !== 'word' || !['yes', 'no', 'true', 'false', '1', '0'].includes(t.text.toLowerCase())) throw fail(t, `boolean expected near ${near(t)}`);
  return t.text;
};

export const int: Value = (c) => {
  const t = word(c.s);
  if (t.kind !== 'word' || !/^\d+$/.test(t.text)) throw fail(t, `expected integer near ${near(t)}`);
  return t.text;
};

export const duration: Value = (c) => {
  const t = word(c.s);
  if (t.kind !== 'word' || !/^(?:\d+[smhdw]?|unlimited|P(?:\d+[YMWD])*(?:T(?:\d+[HMS])+)?)$/i.test(t.text)) {
    throw fail(t, `expected ISO 8601 duration or TTL-style duration near ${near(t)}`);
  }
  return t.text;
};

export const qstring: Value = (c) => {
  const t = word(c.s);
  if (t.kind !== 'string' && t.kind !== 'word') throw fail(t, `expected quoted string near ${near(t)}`);
  return t.text;
};

export const oneOf = (...values: readonly string[]): Value => (c) => {
  const t = word(c.s);
  if (t.kind !== 'word' || !values.includes(t.text.toLowerCase())) throw fail(t, `'${t.text}' unexpected near ${near(t)}`);
  return t.text.toLowerCase();
};

/** Una dirección (o, si `prefix`, una red: 192.168.10.0/24, 10/8, fd00::/8). */
function isAddress(text: string, prefix: boolean): boolean {
  const [addr = '', bits, extra] = text.split('/');
  if (extra !== undefined || (bits !== undefined && (!prefix || !/^\d{1,3}$/.test(bits)))) return false;
  if (addr.includes(':')) return isIpv6(addr) && Number(bits ?? 0) <= 128;
  const short = bits !== undefined && /^\d{1,3}(\.\d{1,3}){0,3}$/.test(addr) && addr.split('.').every((o) => Number(o) <= 255);
  return (isIpv4(addr) || short) && Number(bits ?? 0) <= 32;
}

const looksLikeAddress = (text: string): boolean => /^\d/.test(text) || text.includes(':');

function amlElement(c: Ctx, depth: number): void {
  if (is(c.s.peek(), '!')) c.s.next();
  if (is(c.s.peek(), '{')) { amlList(c, depth + 1); return; }
  const t = word(c.s);
  if (t.kind === 'punct') throw fail(t, `expected IP match list element near ${near(t)}`);
  if (t.kind === 'word' && t.text === 'key') { qstring(c); return; }
  if (looksLikeAddress(t.text)) {
    if (!isAddress(t.text, true)) throw fail(t, `expected IP address near ${near(t)}`);
  } else c.refs.push({ name: t.text, tok: t, seq: c.s.taken });
}

/** Lista de direcciones: `{ 192.168.10.0/24; !10.0.0.1; localnets; nombre-de-acl; key k; { … }; }`. */
function amlList(c: Ctx, depth: number): void {
  if (depth > MAX_AML_DEPTH) throw fail(c.s.peek(), 'address match list nested too deeply');
  items(c, (x) => amlElement(x, depth));
}

export const aml: Value = (c) => {
  amlList(c, 0);
  return undefined;
};

/** Modificadores `port 53`, `dscp 0`, `tls nombre`… delante o detrás de una dirección. */
function modifiers(c: Ctx, allowed: readonly string[]): void {
  for (let t = c.s.peek(); t.kind === 'word' && allowed.includes(t.text.toLowerCase()); t = c.s.peek()) {
    c.s.next();
    if (t.text.toLowerCase() === 'port' || t.text.toLowerCase() === 'dscp') int(c);
    else qstring(c);
  }
}

/** forwarders: `[port N] { 8.8.8.8; 1.1.1.1 port 53; }`. */
export const iplist: Value = (c) => {
  modifiers(c, ['port', 'dscp', 'tls']);
  items(c, (x) => {
    const t = word(x.s);
    if (!isAddress(t.text, false) || t.kind === 'punct') throw fail(t, `expected IP address near ${near(t)}`);
    modifiers(x, ['port', 'dscp', 'tls']);
  });
  return undefined;
};

/** primaries, also-notify: direcciones o nombres de listas `primaries`, con puerto y clave. */
export const hosts: Value = (c) => {
  modifiers(c, ['port', 'dscp', 'source', 'source-v6']);
  items(c, (x) => {
    const t = word(x.s);
    if (t.kind === 'punct' || (looksLikeAddress(t.text) && !isAddress(t.text, false))) throw fail(t, `expected IP address near ${near(t)}`);
    modifiers(x, ['port', 'key', 'tls']);
  });
  return undefined;
};

/** listen-on: `[port N] [tls x] [http x] { lista de direcciones }`. */
export const listen: Value = (c) => {
  modifiers(c, ['port', 'tls', 'http', 'proxy']);
  return aml(c);
};

/** Un valor que no se comprueba: todo hasta el `;` de la sentencia, con sus bloques. */
export const skip: Value = (c) => {
  let depth = 0;
  for (let t = c.s.peek(); depth > 0 || !(is(t, ';') || is(t, '}')); t = c.s.peek()) {
    if (t.kind === 'eof') throw fail(t, 'unexpected end of input');
    if (is(t, '{')) depth++;
    if (is(t, '}')) depth--;
    c.s.next();
  }
  return undefined;
};

/** response-policy: `{ zone "rpz"; … } [opciones];`. */
export const rpz: Value = (c) => {
  items(c, skip);
  return skip(c);
};
