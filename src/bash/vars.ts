/** Shell variables: attributes, dynamic scopes (local), indexed and associative arrays, namerefs. */

export type Attr = 'x' | 'r' | 'i' | 'l' | 'u' | 'n' | 'a' | 'A' | 't';

export type Value =
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'arr'; readonly v: Map<number, string> }
  | { readonly t: 'assoc'; readonly v: Map<string, string> };

export interface Var {
  value?: Value;
  attrs: Set<Attr>;
}

export class VarError extends Error {}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_NAMEREF = 8;

export function isName(s: string): boolean {
  return NAME.test(s);
}

function cloneValue(v: Value | undefined): Value | undefined {
  if (!v || v.t === 'str') return v;
  return v.t === 'arr' ? { t: 'arr', v: new Map(v.v) } : { t: 'assoc', v: new Map(v.v) };
}

/** Indexed array elements in index order. */
export function arrayValues(v: Value | undefined): string[] {
  if (!v) return [];
  if (v.t === 'str') return [v.v];
  if (v.t === 'arr') return [...v.v.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return [...v.v.values()];
}

export function arrayKeys(v: Value | undefined): string[] {
  if (!v) return [];
  if (v.t === 'str') return ['0'];
  if (v.t === 'arr') return [...v.v.keys()].sort((a, b) => a - b).map(String);
  return [...v.v.keys()];
}

/** Scalar view: element 0 of an array, the string otherwise. */
export function scalarOf(v: Value | undefined): string | undefined {
  if (!v) return undefined;
  if (v.t === 'str') return v.v;
  return v.t === 'arr' ? v.v.get(0) : v.v.get('0');
}

export class Vars {
  /** scopes[0] is global; each function call pushes one. */
  private scopes: Map<string, Var>[] = [new Map()];

  clone(): Vars {
    const c = new Vars();
    c.scopes = this.scopes.map((s) => new Map([...s].map(([k, v]) => [k, { value: cloneValue(v.value), attrs: new Set(v.attrs) }])));
    return c;
  }

  pushScope(): void {
    this.scopes.push(new Map());
  }

  /** Back to the global scope (after an aborted command). */
  resetScopes(): void {
    this.scopes.length = 1;
  }

  popScope(): void {
    if (this.scopes.length > 1) this.scopes.pop();
  }

  depth(): number {
    return this.scopes.length - 1;
  }

  /** Follows namerefs (declare -n). */
  resolveName(name: string): string {
    let n = name;
    for (let i = 0; i < MAX_NAMEREF; i++) {
      const v = this.find(n);
      if (!v || !v.attrs.has('n') || v.value?.t !== 'str' || !v.value.v) return n;
      n = v.value.v;
    }
    throw new VarError(`${name}: circular name reference`);
  }

  private find(name: string): Var | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i]?.get(name);
      if (v) return v;
    }
    return undefined;
  }

  get(name: string): Var | undefined {
    return this.find(this.resolveName(name));
  }

  /** Variable record in the scope that owns it, creating it globally (or in the current scope). */
  private ensure(name: string, local = false): Var {
    const n = this.resolveName(name);
    const scope = local ? (this.scopes[this.scopes.length - 1] as Map<string, Var>) : undefined;
    const existing = scope ? scope.get(n) : this.find(n);
    if (existing) return existing;
    const v: Var = { attrs: new Set() };
    (scope ?? (this.scopes[0] as Map<string, Var>)).set(n, v);
    return v;
  }

  /** `local name`: creates the variable in the current function scope. */
  declareLocal(name: string, inherit = false): Var {
    const top = this.scopes[this.scopes.length - 1] as Map<string, Var>;
    const existing = top.get(name);
    if (existing) return existing;
    const outer = this.find(name);
    const v: Var = { attrs: new Set(inherit && outer ? outer.attrs : []), value: inherit ? cloneValue(outer?.value) : undefined };
    top.set(name, v);
    return v;
  }

  /** `declare` at global level or a plain lookup-or-create. */
  declare(name: string, local: boolean): Var {
    return local && this.scopes.length > 1 ? this.declareLocal(name) : this.ensure(name);
  }

  checkWritable(v: Var, name: string): void {
    if (v.attrs.has('r')) throw new VarError(`${name}: readonly variable`);
  }

  private transform(v: Var, value: string): string {
    if (v.attrs.has('l')) return value.toLowerCase();
    if (v.attrs.has('u')) return value.toUpperCase();
    return value;
  }

  /** Scalar assignment (or element 0 of an array). `arith` converts -i values. */
  set(name: string, value: string, opts: { append?: boolean; arith?: (s: string) => string } = {}): void {
    const v = this.ensure(name);
    this.checkWritable(v, name);
    const cur = v.value;
    const old = scalarOf(cur) ?? '';
    let next = value;
    if (v.attrs.has('i') && opts.arith) next = opts.arith(opts.append ? `${old || 0}+(${value || 0})` : value || '0');
    else if (opts.append) next = old + value;
    next = this.transform(v, next);
    if (cur?.t === 'arr') cur.v.set(0, next);
    else if (cur?.t === 'assoc') cur.v.set('0', next);
    else v.value = { t: 'str', v: next };
  }

  /** name[key]=value */
  setElement(name: string, key: string | number, value: string, append = false): void {
    const v = this.ensure(name);
    this.checkWritable(v, name);
    if (!v.value || v.value.t === 'str') {
      const m = new Map<number, string>();
      if (v.value?.t === 'str') m.set(0, v.value.v);
      v.value = v.attrs.has('A') ? { t: 'assoc', v: new Map() } : { t: 'arr', v: m };
    }
    if (v.value.t === 'assoc') {
      const k = String(key);
      v.value.v.set(k, this.transform(v, append ? (v.value.v.get(k) ?? '') + value : value));
      return;
    }
    let i = Number(key);
    if (i < 0) {
      const max = Math.max(-1, ...v.value.v.keys());
      i = max + 1 + i;
      if (i < 0) throw new VarError(`${name}[${key}]: bad array subscript`);
    }
    v.value.v.set(i, this.transform(v, append ? (v.value.v.get(i) ?? '') + value : value));
  }

  /** Replaces the whole array (`name=(…)`), or appends with `+=`. */
  setArray(name: string, items: readonly { key?: string | number; value: string }[], assoc: boolean, append = false): void {
    const v = this.ensure(name);
    this.checkWritable(v, name);
    if (assoc || v.attrs.has('A')) {
      const m = append && v.value?.t === 'assoc' ? v.value.v : new Map<string, string>();
      if (items.length && items.every((it) => it.key === undefined)) {
        // bash 5.1+: `assoc=(k1 v1 k2 v2)` is a list of key/value pairs
        for (let i = 0; i < items.length; i += 2) m.set(items[i]?.value ?? '', this.transform(v, items[i + 1]?.value ?? ''));
      } else items.forEach((it) => m.set(String(it.key ?? ''), this.transform(v, it.value)));
      v.value = { t: 'assoc', v: m };
      v.attrs.add('A');
      return;
    }
    const m = append && v.value?.t === 'arr' ? v.value.v : new Map<number, string>();
    if (append && v.value?.t === 'str') m.set(0, v.value.v);
    let next = m.size ? Math.max(...m.keys()) + 1 : 0;
    for (const it of items) {
      const i = it.key !== undefined ? Number(it.key) : next;
      m.set(i, this.transform(v, it.value));
      next = i + 1;
    }
    v.value = { t: 'arr', v: m };
    v.attrs.add('a');
  }

  unset(name: string, key?: string | number): void {
    const n = this.resolveName(name);
    const v = this.find(n);
    if (!v) return;
    this.checkWritable(v, name);
    if (key === undefined) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const s = this.scopes[i] as Map<string, Var>;
        if (s.has(n)) {
          if (i > 0 && i === this.scopes.length - 1) s.set(n, { attrs: new Set() });
          else s.delete(n);
          return;
        }
      }
      return;
    }
    if (v.value?.t === 'arr') v.value.v.delete(Number(key));
    else if (v.value?.t === 'assoc') v.value.v.delete(String(key));
    else if (Number(key) === 0) v.value = undefined;
  }

  /** Every visible variable (innermost scope wins), sorted by name. */
  visible(): [string, Var][] {
    const seen = new Map<string, Var>();
    for (const s of this.scopes) for (const [k, v] of s) seen.set(k, v);
    return [...seen].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  exported(): Map<string, string> {
    const env = new Map<string, string>();
    for (const [k, v] of this.visible()) {
      const s = scalarOf(v.value);
      if (v.attrs.has('x') && s !== undefined && v.value?.t === 'str') env.set(k, s);
    }
    return env;
  }
}
