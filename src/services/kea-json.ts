/**
 * Lectura de kea-dhcp4.conf como la hace Kea 2.6 (dhcp4_lexer.ll y dhcp4_parser.yy): JSON con comentarios `#`, `//` y
 * de bloque, y en cada mapa solo las palabras clave de su gramática (Spec); una coma final se acepta con un aviso. Los
 * mensajes son los de Parser4Context: «ARCHIVO:LÍNEA.COL[-FIN]: syntax error, unexpected X, expecting Y», «got
 * unexpected keyword "x" in Dhcp4 map.» y «Invalid character: x». Lo que se comprueba después está en kea-check.ts.
 */

export interface Pos { readonly line: number; readonly col: number }

export interface KeaMap { readonly kind: 'map'; readonly entries: ReadonlyMap<string, KeaNode>; readonly pos: Pos }
export type KeaNode =
  | { readonly kind: 'string'; readonly value: string; readonly pos: Pos }
  | { readonly kind: 'integer' | 'float'; readonly value: number; readonly pos: Pos }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly pos: Pos }
  | { readonly kind: 'null'; readonly pos: Pos }
  | KeaMap
  | { readonly kind: 'list'; readonly items: readonly KeaNode[]; readonly pos: Pos };

/** Un mapa con nombre de contexto («Dhcp4», «subnet4»…) y sus claves; `any` admite cualquier JSON. */
export interface MapSpec { readonly map: string; readonly keys: Readonly<Record<string, Spec>> }
export interface ListSpec { readonly list: Spec }
export type Spec = 'string' | 'integer' | 'float' | 'boolean' | 'any' | MapSpec | ListSpec;

export interface KeaParse {
  readonly root?: KeaMap;
  /** El mensaje de la excepción de Kea, sin «Syntax check failed with: ». */
  readonly error?: string;
  /** Avisos de sintaxis («Extraneous comma…»), con su posición. */
  readonly warnings: readonly string[];
}

type Kind = '{' | '}' | '[' | ']' | ',' | ':' | 'string' | 'integer' | 'float' | 'boolean' | 'null' | 'eof';
interface Tok { readonly kind: Kind; readonly text: string; readonly line: number; readonly col: number; readonly last: number }

class ParseError extends Error {}

/** Los nombres de bison: sin comillas salvo los que llevan una coma. */
const NAME: Readonly<Record<Kind, string>> = {
  '{': '{', '}': '}', '[': '[', ']': ']', ',': '","', ':': ':', string: 'constant string', integer: 'integer',
  float: 'floating point', boolean: 'boolean', null: 'null', eof: 'end of file',
};
const NUMBER = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
const WORD = /true|false|null/y;

const pos = (t: Tok): Pos => ({ line: t.line, col: t.col });
/** Maps and lists inside one another before the parser gives up (Kea's own configurations nest about 6 deep). */
const MAX_DEPTH = 200;

class Lexer {
  private readonly text: string;
  readonly file: string;
  private i = 0;
  private line = 1;
  private col = 1;

  constructor(text: string, file: string) {
    this.text = text;
    this.file = file;
  }

  loc(line: number, col: number, last = col): string {
    return `${this.file}:${line}.${col}${last > col ? `-${last}` : ''}`;
  }

  next(): Tok {
    this.skip();
    const { text, i, line, col } = this;
    const c = text[i];
    if (c === undefined) return { kind: 'eof', text: '', line, col, last: col };
    if ('{}[],:'.includes(c)) return this.take(c as Kind, c);
    if (c === '"') return this.string();
    for (const [re, kind] of [[NUMBER, 'number'], [WORD, 'word']] as const) {
      re.lastIndex = i;
      const m = re.exec(text)?.[0];
      if (m === undefined) continue;
      if (kind === 'word') return this.take(m === 'null' ? 'null' : 'boolean', m);
      return this.take(/[.eE]/.test(m) ? 'float' : 'integer', m);
    }
    throw new ParseError(`${this.loc(line, col)}: Invalid character: ${c}`);
  }

  private take(kind: Kind, raw: string, value = raw): Tok {
    const t = { kind, text: value, line: this.line, col: this.col, last: this.col + raw.length - 1 };
    this.i += raw.length;
    this.col += raw.length;
    return t;
  }

  private advance(n: number): void {
    for (const c of this.text.slice(this.i, this.i + n)) {
      if (c === '\n') { this.line++; this.col = 1; } else this.col++;
    }
    this.i += n;
  }

  /** Espacios y comentarios: `#` y `//` hasta el fin de línea, y los de bloque. */
  private skip(): void {
    for (;;) {
      const { text, i } = this;
      const two = text.slice(i, i + 2);
      if (/^\s/.test(text[i] ?? '')) this.advance(1);
      else if (text[i] === '#' || two === '//') {
        const end = text.indexOf('\n', i);
        this.advance((end < 0 ? text.length : end) - i);
      } else if (two === '/*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) throw new ParseError(`${this.loc(this.line, this.col)}: Comment not closed. (/* in line ${this.line})`);
        this.advance(end + 2 - i);
      } else return;
    }
  }

  private string(): Tok {
    const { text, i, line, col } = this;
    let k = i + 1;
    while (k < text.length && text[k] !== '"') k += text[k] === '\\' ? 2 : 1;
    if (k >= text.length) throw new ParseError(`${this.loc(line, col)}: Invalid character: "`);
    const raw = text.slice(i, k + 1);
    if (/[\u0000-\u001f]/.test(raw)) throw new ParseError(`${this.loc(line, col)}: Invalid control in ${raw}`);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ParseError(`${this.loc(line, col)}: Bad escape in ${raw}`);
    }
    return this.take('string', raw, String(value));
  }
}

class Parser {
  private readonly lexer: Lexer;
  readonly warnings: string[] = [];
  private peeked: Tok | undefined;
  private depth = 0;

  constructor(lexer: Lexer) {
    this.lexer = lexer;
  }

  document(top: MapSpec): KeaMap {
    const open = this.next();
    if (open.kind !== '{') throw this.syntax(open, '{');
    const root = this.map(open, top);
    const end = this.next();
    if (end.kind !== 'eof') throw this.syntax(end, 'end of file');
    return root;
  }

  private next(): Tok {
    const t = this.peek();
    this.peeked = undefined;
    return t;
  }

  private peek(): Tok {
    this.peeked ??= this.lexer.next();
    return this.peeked;
  }

  /** Una clave conocida del mapa en curso es una palabra clave del analizador: bison la nombra por su texto. */
  private syntax(t: Tok, expecting: string, spec?: MapSpec): ParseError {
    const name = t.kind === 'string' && spec && Object.hasOwn(spec.keys, t.text) ? t.text : NAME[t.kind];
    return new ParseError(`${this.lexer.loc(t.line, t.col, t.last)}: syntax error, unexpected ${name}${expecting ? `, expecting ${expecting}` : ''}`);
  }

  private warn(comma: Tok): void {
    this.warnings.push(`${this.lexer.loc(comma.line, comma.col)}: Extraneous comma. A piece of configuration may have been omitted.`);
  }

  private value(spec: Spec): KeaNode {
    const t = this.next();
    if (t.kind === '{' || t.kind === '[') {
      this.depth++;
      try {
        return this.nested(t, spec);
      } finally {
        this.depth--;
      }
    }
    if (typeof spec === 'object') throw this.syntax(t, 'map' in spec ? '{' : '[');
    if (spec !== 'any' && t.kind !== spec) throw this.syntax(t, NAME[spec]);
    return this.scalar(t);
  }

  /** A map or list; bison's stack is bounded, and so is this one (no RangeError from a file of «[[[[…»). */
  private nested(t: Tok, spec: Spec): KeaNode {
    if (this.depth > MAX_DEPTH) throw new ParseError(`${this.lexer.loc(t.line, t.col)}: memory exhausted`);
    if (typeof spec === 'object') {
      const want = 'map' in spec ? '{' : '[';
      if (t.kind !== want) throw this.syntax(t, want);
      return 'map' in spec ? this.map(t, spec) : this.list(t, spec.list);
    }
    if (spec !== 'any' && t.kind !== spec) throw this.syntax(t, NAME[spec]);
    return t.kind === '{' ? this.map(t, undefined) : this.list(t, 'any');
  }

  private scalar(t: Tok): KeaNode {
    const p = pos(t);
    switch (t.kind) {
      case 'string': return { kind: 'string', value: t.text, pos: p };
      case 'integer': case 'float': return { kind: t.kind, value: Number(t.text), pos: p };
      case 'boolean': return { kind: 'boolean', value: t.text === 'true', pos: p };
      case 'null': return { kind: 'null', pos: p };
      default: throw this.syntax(t, '');
    }
  }

  private keyword(key: Tok, spec: MapSpec): Spec {
    const sub = Object.hasOwn(spec.keys, key.text) ? spec.keys[key.text] : undefined;
    if (sub === undefined) throw new ParseError(`${this.lexer.loc(key.line, key.col, key.last)}: got unexpected keyword "${key.text}" in ${spec.map} map.`);
    return sub;
  }

  private map(open: Tok, spec: MapSpec | undefined): KeaMap {
    const entries = new Map<string, KeaNode>();
    const done = (): KeaMap => ({ kind: 'map', entries, pos: pos(open) });
    let comma: Tok | undefined;
    for (;;) {
      const key = this.next();
      if (key.kind === '}') {
        if (comma) this.warn(comma);
        return done();
      }
      if (key.kind !== 'string') throw this.syntax(key, spec ? '' : 'constant string or }', spec);
      const colon = this.next();
      if (colon.kind !== ':') throw this.syntax(colon, ':', spec);
      const sub = spec ? this.keyword(key, spec) : 'any';
      const prev = entries.get(key.text);
      if (spec && prev) {
        const file = this.lexer.file;
        throw new ParseError(`${file}:${key.line}:${key.col}: duplicate ${key.text} entries in ${spec.map} map (previous at ${file}:${prev.pos.line}:${prev.pos.col})`);
      }
      entries.set(key.text, this.value(sub));
      const sep = this.next();
      if (sep.kind === '}') return done();
      if (sep.kind !== ',') throw this.syntax(sep, '"," or }', spec);
      comma = sep;
    }
  }

  private list(open: Tok, item: Spec): KeaNode {
    const items: KeaNode[] = [];
    const done = (): KeaNode => ({ kind: 'list', items, pos: pos(open) });
    if (this.peek().kind === ']') { this.next(); return done(); }
    for (;;) {
      items.push(this.value(item));
      const sep = this.next();
      if (sep.kind === ']') return done();
      if (sep.kind !== ',') throw this.syntax(sep, '"," or ]');
      if (this.peek().kind === ']') {
        this.warn(sep);
        this.next();
        return done();
      }
    }
  }
}

/** Lee el archivo con la gramática `top`; se detiene en el primer error, como el analizador de Kea. */
export function parseKea(text: string, file: string, top: MapSpec): KeaParse {
  const parser = new Parser(new Lexer(text, file));
  try {
    return { root: parser.document(top), warnings: parser.warnings };
  } catch (err) {
    if (err instanceof ParseError) return { error: err.message, warnings: parser.warnings };
    throw err;
  }
}
