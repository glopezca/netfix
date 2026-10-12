/** GNU sort comparison: keys (-k F[.C][opts],F[.C]), -t, -n -h -V -g -M -f -b -r -u, last-resort byte comparison. */

interface KeySpec {
  readonly f1: number;
  readonly c1: number;
  readonly f2: number;
  readonly c2: number;
  readonly opts: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseKey(spec: string): KeySpec {
  const [a = '', b] = spec.split(',');
  const m1 = /^(\d+)(?:\.(\d+))?([a-zA-Z]*)$/.exec(a);
  const m2 = b === undefined ? null : /^(\d+)(?:\.(\d+))?([a-zA-Z]*)$/.exec(b);
  return {
    f1: Number(m1?.[1] ?? 1), c1: Number(m1?.[2] ?? 1), f2: m2 ? Number(m2[1]) : Infinity, c2: m2?.[2] ? Number(m2[2]) : 0,
    opts: (m1?.[3] ?? '') + (m2?.[3] ?? ''),
  };
}

/** Fields with their start offsets; without -t a field includes its leading blanks (as in GNU sort). */
function fields(line: string, sep: string | undefined): { text: string; start: number }[] {
  if (sep !== undefined) {
    let pos = 0;
    return line.split(sep).map((t) => { const f = { text: t, start: pos }; pos += t.length + sep.length; return f; });
  }
  const out: { text: string; start: number }[] = [];
  const re = /[ \t]*[^ \t]+/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push({ text: m[0], start: m.index });
  if (!out.length) out.push({ text: line, start: 0 });
  return out;
}

function extract(line: string, k: KeySpec, sep: string | undefined, blanks: boolean): string {
  const fs = fields(line, sep);
  const f1 = fs[k.f1 - 1];
  if (!f1) return '';
  const skip = (t: string): number => (blanks ? t.length - t.trimStart().length : 0);
  const start = f1.start + skip(f1.text) + k.c1 - 1;
  let end = line.length;
  if (k.f2 !== Infinity) {
    const f2 = fs[k.f2 - 1];
    end = !f2 ? line.length : k.c2 === 0 ? f2.start + f2.text.length : f2.start + skip(f2.text) + k.c2;
  }
  return line.slice(start, Math.max(start, end));
}

function numeric(s: string): number {
  const m = /^\s*(-?\d*\.?\d*)/.exec(s);
  const v = Number(m?.[1] ?? '');
  return Number.isFinite(v) && m?.[1] !== '' && m?.[1] !== '-' ? v : 0;
}

function human(s: string): number {
  const m = /^\s*(-?\d*\.?\d+)([KMGTPE]?)/i.exec(s);
  if (!m) return 0;
  return Number(m[1]) * 1024 ** ' KMGTPE'.indexOf((m[2] || ' ').toUpperCase());
}

function versionCmp(a: string, b: string): number {
  const pa = a.match(/\d+|\D+/g) ?? [];
  const pb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const d = /^\d/.test(x) && /^\d/.test(y) ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (d) return d;
  }
  return 0;
}

const byte = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareBy(opts: string, a: string, b: string): number {
  let x = a;
  let y = b;
  if (opts.includes('b')) { x = x.trimStart(); y = y.trimStart(); }
  if (opts.includes('d')) { x = x.replace(/[^\w\s]/g, ''); y = y.replace(/[^\w\s]/g, ''); }
  if (opts.includes('n')) return numeric(x) - numeric(y);
  if (opts.includes('g')) return (Number.parseFloat(x) || 0) - (Number.parseFloat(y) || 0);
  if (opts.includes('h')) return human(x) - human(y);
  if (opts.includes('V')) return versionCmp(x, y);
  if (opts.includes('M')) return MONTHS.indexOf(x.trim().slice(0, 3).toUpperCase()) - MONTHS.indexOf(y.trim().slice(0, 3).toUpperCase());
  if (opts.includes('f')) { x = x.toUpperCase(); y = y.toUpperCase(); }
  return byte(x, y);
}

export function sortLines(input: readonly string[], opts: ReadonlyMap<string, string | true>, keySpecs: readonly string[]): string[] {
  const global = ['n', 'f', 'b', 'h', 'V', 'g', 'M', 'd', 'r'].filter((c) => opts.has(c)).join('');
  const sep = typeof opts.get('t') === 'string' ? (opts.get('t') as string) : undefined;
  const keys = keySpecs.map(parseKey);
  const cmpKeys = (a: string, b: string): number => {
    for (const k of keys) {
      const o = k.opts.replace(/r/g, '') ? k.opts : global;
      const d = compareBy(o, extract(a, k, sep, o.includes('b')), extract(b, k, sep, o.includes('b')));
      if (d) return (k.opts ? k.opts.includes('r') : global.includes('r')) ? -d : d;
    }
    if (!keys.length) {
      const d = compareBy(global, a, b);
      if (d) return global.includes('r') ? -d : d;
    }
    return 0;
  };
  const cmp = (a: string, b: string): number => {
    const d = cmpKeys(a, b);
    if (d || opts.has('s') || opts.has('u')) return d;
    const last = byte(a, b);
    return global.includes('r') ? -last : last;
  };
  const sorted = [...input].sort(cmp);
  if (!opts.has('u')) return sorted;
  return sorted.filter((l, i) => i === 0 || cmpKeys(sorted[i - 1] ?? '', l) !== 0);
}
