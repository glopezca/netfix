/**
 * The YAML subset netplan files use: block mappings, block sequences ("- x" and "- key: value"), flow
 * sequences ([a, b]), plain or quoted scalars and # comments. Linear and bounded; anchors, tags, multi-line
 * strings and flow mappings are reported as errors.
 */

export type YamlValue = string | YamlValue[] | YamlMap;
export interface YamlMap {
  readonly [key: string]: YamlValue;
}

export interface YamlError {
  readonly line: number;
  readonly col: number;
  readonly message: string;
}

export const MAX_YAML_LINES = 400;
/** Longer lines are refused (the key regex would take quadratic time on a huge line without «:»). */
export const MAX_YAML_LINE = 1024;

interface Line {
  readonly no: number;
  readonly indent: number;
  readonly text: string;
}

function stripComment(raw: string): string {
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1] ?? ''))) return raw.slice(0, i);
  }
  return raw;
}

function scalar(text: string, line: number, col: number): YamlValue | YamlError {
  const t = text.trim();
  if (/^["'].*["']$/.test(t) && t.length >= 2) return t.slice(1, -1);
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) return { line, col, message: 'unterminated flow sequence' };
    const inner = t.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')) : [];
  }
  if (/^[{&*!|>]/.test(t)) return { line, col, message: `unsupported YAML syntax "${t[0]}"` };
  return t;
}

const isError = (v: unknown): v is YamlError => typeof v === 'object' && v !== null && 'message' in v && 'line' in v;

class Parser {
  private i = 0;
  private readonly lines: readonly Line[];

  constructor(lines: readonly Line[]) {
    this.lines = lines;
  }

  block(indent: number): YamlValue | YamlError {
    const first = this.lines[this.i];
    if (!first || first.indent < indent) return '';
    return first.text.startsWith('- ') || first.text === '-' ? this.sequence(first.indent) : this.mapping(first.indent);
  }

  private mapping(indent: number): YamlMap | YamlError {
    const out: Record<string, YamlValue> = {};
    for (let l = this.lines[this.i]; l && l.indent === indent && !l.text.startsWith('-'); l = this.lines[this.i]) {
      const m = /^("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(l.text);
      if (!m) return { line: l.no, col: l.indent + 1, message: 'could not find expected \':\'' };
      const key = (m[1] ?? '').replace(/^["']|["']$/g, '');
      if (key === '__proto__') return { line: l.no, col: l.indent + 1, message: `invalid key "${key}"` };
      if (Object.hasOwn(out, key)) return { line: l.no, col: l.indent + 1, message: `duplicate key "${key}"` };
      this.i++;
      const value = m[2] !== undefined && m[2].trim() !== '' ? scalar(m[2], l.no, l.indent + key.length + 3) : this.child(indent);
      if (isError(value)) return value;
      out[key] = value;
    }
    const next = this.lines[this.i];
    if (next && next.indent > indent) return { line: next.no, col: next.indent + 1, message: 'bad indentation of a mapping entry' };
    return out;
  }

  private child(parent: number): YamlValue | YamlError {
    const next = this.lines[this.i];
    if (next && (next.indent > parent || (next.indent === parent && next.text.startsWith('- ')))) return this.block(next.indent);
    return '';
  }

  private sequence(indent: number): YamlValue[] | YamlError {
    const out: YamlValue[] = [];
    for (let l = this.lines[this.i]; l && l.indent === indent && (l.text.startsWith('- ') || l.text === '-'); l = this.lines[this.i]) {
      const rest = l.text.slice(1).trimStart();
      if (/^[^\s"'[][^:]*:(\s|$)/.test(rest)) {
        // "- key: value" starts a mapping whose keys are indented like `key`.
        const inner = indent + (l.text.length - rest.length);
        (this.lines as Line[])[this.i] = { no: l.no, indent: inner, text: rest };
        const m = this.mapping(inner);
        if (isError(m)) return m;
        out.push(m);
        continue;
      }
      this.i++;
      const v = rest ? scalar(rest, l.no, indent + 3) : this.child(indent);
      if (isError(v)) return v;
      out.push(v);
    }
    return out;
  }
}

/** Parses `text`; the result is a mapping (or an error with its 1-based line and column). */
export function parseYaml(text: string): YamlMap | YamlError {
  const raw = text.split('\n');
  if (raw.length > MAX_YAML_LINES) return { line: MAX_YAML_LINES, col: 1, message: 'file too long' };
  const long = raw.findIndex((r) => r.length > MAX_YAML_LINE);
  if (long >= 0) return { line: long + 1, col: MAX_YAML_LINE + 1, message: 'line too long' };
  const lines: Line[] = [];
  raw.forEach((r, idx) => {
    if (r.includes('\t')) lines.push({ no: idx + 1, indent: -1, text: '\t' });
    const body = stripComment(r).trimEnd();
    if (!body.trim() || body.trim() === '---') return;
    lines.push({ no: idx + 1, indent: body.length - body.trimStart().length, text: body.trim() });
  });
  const tab = lines.find((l) => l.indent < 0);
  if (tab) return { line: tab.no, col: 1, message: 'found character that cannot start any token (tabs are not allowed)' };
  if (!lines.length) return {};
  const p = new Parser(lines);
  const v = p.block(lines[0]?.indent ?? 0);
  if (isError(v)) return v;
  if (typeof v === 'string' || Array.isArray(v)) return { line: lines[0]?.no ?? 1, col: 1, message: 'the document must be a mapping' };
  return v;
}

export function isYamlError(v: YamlMap | YamlError): v is YamlError {
  return isError(v);
}
