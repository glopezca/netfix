/**
 * The order in which bash lists an associative array: its hash table (hashlib.c). Keys hash with FNV-1 over the bytes
 * (as signed chars) into 1024 buckets; each new key goes to the front of its bucket, and the listing walks the buckets
 * in order. When the table holds twice as many keys as buckets, it grows four times and rehashes walking the old buckets.
 * Replaying the keys in insertion order (a Map's) gives bash's order; it is exact unless keys were removed while the
 * table grew.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const INITIAL_BUCKETS = 1024;
const GROW_FACTOR = 2;
const GROW_MULTIPLIER = 4;
const encoder = new TextEncoder();

/** bash's hash_string: FNV-1, 32 bits, each byte xored as a signed char. */
export function hashString(s: string): number {
  let h = FNV_OFFSET;
  const bytes = /^[\x00-\x7f]*$/.test(s) ? null : encoder.encode(s);
  const n = bytes ? bytes.length : s.length;
  for (let i = 0; i < n; i++) {
    const byte = bytes ? bytes[i] ?? 0 : s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) ^ (byte < 128 ? byte : byte - 256);
  }
  return h >>> 0;
}

type Buckets = (string[] | undefined)[];

/** Each bucket keeps its keys oldest first; the walk reverses them (bash puts new keys at the front). */
function place(buckets: Buckets, key: string, size: number): void {
  const b = hashString(key) & (size - 1);
  const list = buckets[b];
  if (list) list.push(key);
  else buckets[b] = [key];
}

function walk(buckets: Buckets): string[] {
  const out: string[] = [];
  for (const list of buckets) if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i] ?? '');
  return out;
}

/** The last order of each array, with the insertion order it came from (checked before reuse). */
const cache = new WeakMap<ReadonlyMap<string, string>, { readonly keys: readonly string[]; readonly order: readonly string[] }>();

function sameKeys(m: ReadonlyMap<string, string>, keys: readonly string[]): boolean {
  if (m.size !== keys.length) return false;
  let i = 0;
  for (const k of m.keys()) if (k !== keys[i++]) return false;
  return true;
}

/** The keys of an associative array as `${!a[@]}` lists them (cached while its keys do not change). */
export function assocKeys(m: ReadonlyMap<string, string>): readonly string[] {
  const hit = cache.get(m);
  if (hit && sameKeys(m, hit.keys)) return hit.order;
  const keys = [...m.keys()];
  const order = assocOrder(keys);
  cache.set(m, { keys, order });
  return order;
}

/** The keys as `${!a[@]}` lists them, from the keys in insertion order. */
export function assocOrder(keys: Iterable<string>): string[] {
  let size = INITIAL_BUCKETS;
  let buckets: Buckets = new Array<string[] | undefined>(size);
  let count = 0;
  for (const key of keys) {
    if (count >= size * GROW_FACTOR) {
      const old = walk(buckets);
      size *= GROW_MULTIPLIER;
      buckets = new Array<string[] | undefined>(size);
      for (const k of old) place(buckets, k, size);
    }
    place(buckets, key, size);
    count++;
  }
  return walk(buckets);
}
