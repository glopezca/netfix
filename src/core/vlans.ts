/** VLAN lists as IOS reads and writes them: "1,3-5,7". */

export const MAX_VLAN = 4094;

/** Consecutive VLANs as a range, as IOS writes them ("1,3-5,7"). */
export function vlanRanges(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i] ?? 0;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i] ?? end;
    parts.push(end > start ? `${start}-${end}` : `${start}`);
  }
  return parts.join(',');
}

/** "1,3-5,7" → [1, 3, 4, 5, 7]; null when a part is not a VLAN or a range of them. */
export function parseVlanList(text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > MAX_VLAN || b < a) return null;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return out;
}

/**
 * `switchport trunk allowed vlan …` applied to the current list (undefined = all): a list, `add`, `remove`,
 * `except`, `all` (back to undefined) or `none`. null when the list is not valid.
 */
export function allowedVlans(current: readonly number[] | undefined, text: string): readonly number[] | undefined | null {
  const [word = '', ...rest] = text.trim().split(/\s+/);
  const verb = word.toLowerCase();
  if (verb === 'all' && rest.length === 0) return undefined;
  if (verb === 'none' && rest.length === 0) return [];
  const listText = ['add', 'remove', 'except'].includes(verb) ? rest.join('') : text.replace(/\s+/g, '');
  const list = parseVlanList(listText);
  if (!list) return null;
  const all = (): number[] => Array.from({ length: MAX_VLAN }, (_, i) => i + 1);
  const base = current ?? all();
  if (verb === 'add') return [...new Set([...base, ...list])].sort((a, b) => a - b);
  if (verb === 'remove') return base.filter((v) => !list.includes(v));
  if (verb === 'except') return all().filter((v) => !list.includes(v));
  return [...new Set(list)].sort((a, b) => a - b);
}
