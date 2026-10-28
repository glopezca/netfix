/** Word expansion: brace, tilde, parameter, command, arithmetic, splitting, pathname, quote removal. */
import type { Word } from './ast.ts';
import type { Part } from './wordparse.ts';
import { parseWord, parseDouble } from './wordparse.ts';
import { braceExpand } from './brace.ts';
import { hasGlob } from './glob.ts';
import { ParamExpander, ExpansionError } from './params.ts';
import type { ParamApi } from './params.ts';
import type { Vars } from './vars.ts';

export { ExpansionError };

export interface ExpandApi {
  readonly vars: Vars;
  special(name: string): string | readonly string[] | undefined;
  positional(): readonly string[];
  arith(expr: string): bigint;
  commandSub(src: string, mode: 'sub' | 'cur' | 'val'): string;
  procSub(dir: '<' | '>', src: string): string;
  home(user: string): string | undefined;
  glob(pattern: string): string[];
  promptExpand(s: string): string;
  readonly opts: {
    readonly nounset: boolean;
    readonly noglob: boolean;
    readonly nullglob: boolean;
    readonly failglob: boolean;
    readonly braceexpand: boolean;
    readonly patsubReplacement: boolean;
  };
}

interface Seg {
  readonly text: string;
  readonly quoted: boolean;
  /** Result of an unquoted expansion: subject to word splitting. */
  readonly split: boolean;
}

/** `atEmpty`: produced by "$@" with no values — dropped if nothing else ends up in it. */
type Field = Seg[] & { atEmpty?: boolean };

const GLOB_SPECIAL = /[*?[\]\\()|!@+]/g;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

export const escapeGlob = (s: string): string => s.replace(GLOB_SPECIAL, '\\$&');

function ifsOf(vars: Vars): string {
  const v = vars.get('IFS');
  return v?.value?.t === 'str' ? v.value.v : v ? '' : ' \t\n';
}

export class Expander {
  private readonly api: ExpandApi;
  private readonly params: ParamExpander;

  constructor(api: ExpandApi) {
    this.api = api;
    const p: ParamApi = {
      get vars() { return api.vars; },
      special: (n) => api.special(n),
      positional: () => api.positional(),
      arith: (e) => this.arith(e),
      operand: (raw) => this.word(raw),
      pattern: (raw) => this.pattern(raw),
      promptExpand: (s) => api.promptExpand(s),
      get nounset() { return api.opts.nounset; },
      get patsubReplacement() { return api.opts.patsubReplacement; },
    };
    this.params = new ParamExpander(p);
  }

  /** Arithmetic expression after parameter/command expansion of its text. */
  arith(expr: string): bigint {
    return this.api.arith(this.dqString(expr));
  }

  /** Text expanded as if inside double quotes (arithmetic bodies, here-documents). */
  dqString(text: string): string {
    return this.fieldsOf(parseDouble(text), true).map(joinField).join(' ');
  }

  // ------------------------------------------------------------ public entry points

  /** Full expansion of command words into fields. */
  words(words: readonly Word[]): string[] {
    const out: string[] = [];
    for (const w of words) {
      const raws = this.api.opts.braceexpand ? braceExpand(w.raw) : [w.raw];
      for (const raw of raws) out.push(...this.fieldsAfterSplit(raw));
    }
    return out;
  }

  private fieldsAfterSplit(raw: string): string[] {
    const parts = this.tilde(parseWord(raw), false);
    const out: string[] = [];
    for (const field of this.fieldsOf(parts, false)) {
      for (const f of this.split(field)) out.push(...this.globField(f));
    }
    return out;
  }

  /** One string: no splitting or globbing (assignments, redirections, case word, here-strings). */
  word(raw: string, assignment = false): string {
    return this.fieldsOf(this.tilde(parseWord(raw), assignment), false).map(joinField).join(' ');
  }

  /** Pattern for case, [[ == ]] and ${v#…}: quoted characters are escaped. */
  pattern(raw: string): string {
    return this.patternAndTrace(raw)[0];
  }

  /** The pattern and how bash's trace shows it (every quoted character behind a backslash), from one expansion. */
  patternAndTrace(raw: string): [string, string] {
    const fields = this.fieldsOf(this.tilde(parseWord(raw), false), false);
    const show = (escape: (text: string) => string): string => fields.map((f) => f.map((s) => (s.quoted ? escape(s.text) : s.text)).join('')).join(' ');
    return [show(escapeGlob), show((text) => text.replace(/./gsu, '\\$&'))];
  }

  /** Regex for [[ =~ ]]: quoted parts match literally. */
  regex(raw: string): string {
    return this.fieldsOf(parseWord(raw), false).map((f) => f.map((s) => (s.quoted ? s.text.replace(REGEX_SPECIAL, '\\$&') : s.text)).join('')).join(' ');
  }

  /** Here-document body: $, ` and \ are special; quotes are not. */
  heredoc(body: string): string {
    const protectedQuotes = body.replace(/\\(?=["'])/g, '\\\\');
    return this.dqString(protectedQuotes.replace(/"/g, '\\"'));
  }

  // ------------------------------------------------------------ parts → fields

  private tilde(parts: Part[], assignment: boolean): Part[] {
    const first = parts[0];
    if (first?.t !== 'lit') return parts;
    const pieces = assignment ? first.v.split(':') : [first.v];
    const out: Part[] = [];
    pieces.forEach((piece, i) => {
      if (i > 0) out.push({ t: 'lit', v: ':' });
      const m = /^~([^/:]*)/.exec(piece);
      const home = m ? this.tildeHome(m[1] ?? '') : undefined;
      if (!m || home === undefined) { if (piece) out.push({ t: 'lit', v: piece }); return; }
      out.push({ t: 'q', v: home });
      if (piece.length > m[0].length) out.push({ t: 'lit', v: piece.slice(m[0].length) });
    });
    return [...out, ...parts.slice(1)];
  }

  private tildeHome(who: string): string | undefined {
    if (who === '') return this.homeVar();
    if (who === '+') return this.varText('PWD');
    if (who === '-') return this.varText('OLDPWD');
    return this.api.home(who);
  }

  private homeVar(): string | undefined {
    return this.varText('HOME');
  }

  private varText(name: string): string | undefined {
    const v = this.api.vars.get(name)?.value;
    return v?.t === 'str' ? v.v : undefined;
  }

  /** Expands parts; `inDq` makes every result quoted. Multi-valued "$@" creates field boundaries. */
  private fieldsOf(parts: readonly Part[], inDq: boolean): Field[] {
    const fields: Field[] = [[]];
    const cur = (): Field => fields[fields.length - 1] as Field;
    for (const part of parts) {
      switch (part.t) {
        case 'lit': cur().push({ text: part.v, quoted: inDq, split: false }); break;
        case 'q': cur().push({ text: part.v, quoted: true, split: false }); break;
        case 'dq': {
          const inner = this.fieldsOf(part.parts, true);
          const only = inner[0];
          if (inner.length === 1 && only && only.length === 0) {
            if (only.atEmpty) cur().atEmpty = true;
            else cur().push({ text: '', quoted: true, split: false });
            break;
          }
          inner.forEach((f, i) => { if (i > 0) fields.push([]); cur().push(...f); });
          break;
        }
        case 'param': this.pushParam(fields, part.body, inDq); break;
        case 'cmd': cur().push({ text: this.api.commandSub(part.src, part.mode), quoted: inDq, split: !inDq }); break;
        case 'arith': cur().push({ text: String(this.arith(part.expr)), quoted: inDq, split: !inDq }); break;
        case 'proc': cur().push({ text: this.api.procSub(part.dir, part.src), quoted: true, split: false }); break;
      }
    }
    return fields;
  }

  private pushParam(fields: Field[], body: string, inDq: boolean): void {
    const r = this.params.expand(body);
    const cur = (): Field => fields[fields.length - 1] as Field;
    if (r.multi && !(r.star && inDq)) {
      if (r.values.length === 0) {
        if (inDq) cur().atEmpty = true;
        return;
      }
      r.values.forEach((v, i) => {
        if (i > 0) fields.push([]);
        cur().push({ text: v, quoted: inDq, split: !inDq });
      });
      return;
    }
    const text = r.star ? r.values.join(ifsOf(this.api.vars).slice(0, 1)) : r.values.join(' ');
    cur().push({ text, quoted: inDq, split: !inDq });
  }

  // ------------------------------------------------------------ splitting and globbing

  private split(field: Field): Field[] {
    if (field.atEmpty && field.length === 0) return [];
    const ifs = ifsOf(this.api.vars);
    if (!field.some((s) => s.split) || ifs === '') return keep(field) ? [field] : [];
    const ws = new Set<string>([...ifs].filter((c) => c === ' ' || c === '\t' || c === '\n'));
    const out: Field[] = [];
    let cur: Field = [];
    let pendingDelim = false;
    const flush = (force: boolean): void => {
      if (force || keep(cur)) out.push(cur);
      cur = [];
    };
    for (const seg of field) {
      if (!seg.split) { cur.push(seg); pendingDelim = false; continue; }
      let text = '';
      for (const ch of seg.text) {
        if (!ifs.includes(ch)) { text += ch; pendingDelim = false; continue; }
        if (text) cur.push({ text, quoted: false, split: false });
        text = '';
        if (ws.has(ch)) {
          if (cur.length) { flush(false); pendingDelim = true; }
        } else {
          if (!pendingDelim || cur.length) flush(true);
          pendingDelim = false;
          cur = [];
        }
      }
      if (text) cur.push({ text, quoted: false, split: false });
    }
    flush(false);
    return out;
  }

  private globField(field: Field): string[] {
    const literal = joinField(field);
    if (this.api.opts.noglob || !field.some((s) => !s.quoted && hasGlob(s.text))) return [literal];
    const pattern = field.map((s) => (s.quoted ? escapeGlob(s.text) : s.text)).join('');
    const matches = this.api.glob(pattern);
    if (matches.length) return matches;
    if (this.api.opts.failglob) throw new ExpansionError(`no match: ${literal}`);
    if (this.api.opts.nullglob) return [];
    return [literal];
  }
}

function keep(field: Field): boolean {
  return field.some((s) => s.quoted || s.text !== '');
}

function joinField(field: Field): string {
  return field.map((s) => s.text).join('');
}
