/**
 * One Midnight Commander panel: directory listing, cursor, marked files and its drawing. As in mc, each panel has its
 * own sort order, filter and listing format (Full or Brief), and can show Info or a Quick view instead of the list.
 */
import type { Span } from './buffer.ts';
import { fit } from './buffer.ts';
import type { McEntry, McFs } from './mc-fs.ts';
import { joinPath, shortPath } from './mc-fs.ts';
import { hotLabel, mcT } from './mc-i18n.ts';

/** A column's title, as mc takes it from its sort field ("&Modify time" → "Modify time"). */
const column = (msgid: string): string => hotLabel(mcT(msgid)).text;
/** A title centred in its column, as mc draws them. */
const centred = (text: string, width: number): string => fit(text.padStart(Math.ceil((width + text.length) / 2)), width);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIZE_W = 7;
const TIME_W = 12;

export type SortKey = 'unsorted' | 'name' | 'extension' | 'mtime' | 'size';
/** The letter mc shows in the header's corner for each sort order. */
const SORT_MARK: Readonly<Record<SortKey, string>> = { unsorted: 'u', name: 'n', extension: 'e', mtime: 'm', size: 's' };
export type PanelMode = 'list' | 'info' | 'quick';

export function mcTime(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export function humanSize(n: number): string {
  if (n < 1_000_000) return String(n);
  return `${Math.round(n / 1024)}K`;
}

/** A shell pattern (*, ?, [...]) as a regular expression on the whole name. */
export function globRe(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

const ext = (name: string): string => { const at = name.lastIndexOf('.'); return at > 0 ? name.slice(at + 1) : ''; };

function compare(key: SortKey, a: McEntry, b: McEntry): number {
  switch (key) {
    case 'unsorted': return 0;
    case 'extension': return ext(a.name).localeCompare(ext(b.name)) || a.name.localeCompare(b.name);
    case 'mtime': return a.mtime - b.mtime || a.name.localeCompare(b.name);
    case 'size': return b.size - a.size || a.name.localeCompare(b.name);
    default: return a.name.localeCompare(b.name);
  }
}

const UP: McEntry = { name: '..', dir: true, link: false, exec: false, size: 4096, mtime: 0 };

export class Panel {
  dir: string;
  entries: McEntry[] = [];
  cursor = 0;
  top = 0;
  readonly marked = new Set<string>();
  error: string | null = null;
  sort: SortKey = 'name';
  reverse = false;
  /** Left/Right › Filter: a shell pattern files must match (directories always show). */
  filter: string | null = null;
  brief = false;
  mode: PanelMode = 'list';
  /** Options › Panel options, shared by both panels. */
  hidden = true;
  mix = false;
  /** Command › Show directory sizes: what each directory holds, until the panel is read again. */
  readonly sizes = new Map<string, number>();

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Re-reads the directory, keeping the cursor on `keep` when it still exists. */
  reload(fs: McFs, keep?: string): void {
    const listed = fs.list(this.dir);
    this.sizes.clear();
    if (typeof listed === 'string') {
      this.error = listed;
      this.entries = [UP];
    } else {
      this.error = null;
      const re = this.filter ? globRe(this.filter) : null;
      const shown = listed.filter((e) => (this.hidden || !e.name.startsWith('.')) && (e.dir || !re || re.test(e.name)));
      const sign = this.reverse ? -1 : 1;
      const sorted = [...shown].sort((a, b) => (this.mix ? 0 : Number(b.dir) - Number(a.dir)) || sign * compare(this.sort, a, b));
      this.entries = this.dir === (fs.root ?? '/') ? sorted : [UP, ...sorted];
    }
    for (const m of [...this.marked]) if (!this.entries.some((e) => e.name === m)) this.marked.delete(m);
    const at = keep === undefined ? -1 : this.entries.findIndex((e) => e.name === keep);
    this.cursor = Math.max(0, Math.min(at >= 0 ? at : this.cursor, this.entries.length - 1));
  }

  current(): McEntry | undefined {
    return this.entries[this.cursor];
  }

  /** Marked files, or the one under the cursor (never ".."). */
  selection(): string[] {
    const marked = this.entries.filter((e) => this.marked.has(e.name)).map((e) => e.name);
    if (marked.length) return marked;
    const cur = this.current();
    return cur && cur.name !== '..' ? [cur.name] : [];
  }

  move(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.entries.length - 1, this.cursor + delta));
  }

  toggleMark(down = true): void {
    const cur = this.current();
    if (!cur || cur.name === '..') return;
    if (this.marked.has(cur.name)) this.marked.delete(cur.name);
    else this.marked.add(cur.name);
    if (down) this.move(1);
  }

  /** Marks (or unmarks) the entries whose names match a shell pattern; directories only when `dirs`. */
  markMatching(pattern: string, on: boolean, dirs: boolean): void {
    const re = globRe(pattern);
    for (const e of this.entries) {
      if (e.name === '..' || (e.dir && !dirs) || !re.test(e.name)) continue;
      if (on) this.marked.add(e.name);
      else this.marked.delete(e.name);
    }
  }

  invertMarks(): void {
    for (const e of this.entries) {
      if (e.name === '..' || e.dir) continue;
      if (this.marked.has(e.name)) this.marked.delete(e.name);
      else this.marked.add(e.name);
    }
  }

  /** Enters the directory under the cursor (".." goes up). */
  enter(fs: McFs): boolean {
    const cur = this.current();
    if (!cur?.dir) return false;
    const from = this.dir;
    this.go(fs, joinPath(this.dir, cur.name), cur.name === '..' ? from.split('/').pop() : undefined);
    return true;
  }

  /** Shows another folder. */
  go(fs: McFs, dir: string, keep?: string): void {
    this.dir = dir;
    this.marked.clear();
    this.cursor = 0;
    this.top = 0;
    this.reload(fs, keep);
  }

  private nameStyle(e: McEntry, i: number, active: boolean): Span['style'] {
    if (active && i === this.cursor) return 'cursor';
    if (this.marked.has(e.name)) return 'marked';
    if (e.dir) return 'dir';
    if (e.link) return 'link';
    return e.exec ? 'exec' : 'panel';
  }

  private label(e: McEntry): string {
    return (e.dir ? '/' : e.link ? '@' : e.exec ? '*' : ' ') + e.name;
  }

  private row(e: McEntry, i: number, width: number, active: boolean): Span[] {
    const nameW = Math.max(4, width - SIZE_W - TIME_W - 2);
    const dirSize = this.sizes.get(e.name);
    const size = e.name === '..' ? mcT('UP--DIR') : dirSize !== undefined ? humanSize(dirSize) : e.dir ? mcT('DIR') : humanSize(e.size);
    const time = e.name === '..' ? '' : mcTime(e.mtime);
    return [{ text: `${fit(this.label(e), nameW)}│${size.padStart(SIZE_W)}│${fit(time, TIME_W)}`, style: this.nameStyle(e, i, active) }];
  }

  /** Brief: the names in two columns. */
  private briefRow(r: number, rows: number, width: number, active: boolean): Span[] {
    const colW = Math.floor((width - 1) / 2);
    const cell = (i: number, w: number): Span => {
      const e = this.entries[i];
      return e ? { text: fit(this.label(e), w), style: this.nameStyle(e, i, active) } : { text: ' '.repeat(w), style: 'panel' };
    };
    return [cell(this.top + r, colW), { text: '│', style: 'panel' }, cell(this.top + rows + r, width - 1 - colW)];
  }

  private header(inner: number): Span[] {
    const mark = `.${this.reverse ? SORT_MARK[this.sort].toUpperCase() : SORT_MARK[this.sort]}`;
    if (this.brief) {
      const colW = Math.floor((inner - 1) / 2);
      return [{ text: `${fit(`${mark}  ${column('&Name')}`, colW)}│${fit(column('&Name'), inner - 1 - colW)}`, style: 'panelHead' }];
    }
    const nameW = Math.max(4, inner - SIZE_W - TIME_W - 2);
    return [{ text: `${fit(`${mark}   ${column('&Name')}`, nameW)}│${centred(column('&Size'), SIZE_W)}│${centred(column('&Modify time'), TIME_W)}`, style: 'panelHead' }];
  }

  private listRows(inner: number, listRows: number, active: boolean): Span[][] {
    const rows: Span[][] = [];
    for (let r = 0; r < listRows; r++) {
      const i = this.top + r;
      const e = this.entries[i];
      rows.push(this.brief ? this.briefRow(r, listRows, inner, active) : e ? this.row(e, i, inner, active) : [{ text: ' '.repeat(inner), style: 'panel' }]);
    }
    return rows;
  }

  /**
   * Rows of the panel (borders included), `height` rows high. `aside` is what Info or Quick view show instead of the
   * list; `miniStatus` keeps the line under it with the file under the cursor.
   */
  render(width: number, height: number, active: boolean, fs: McFs, aside: readonly string[] | null = null, miniStatus = true): Span[][] {
    const inner = width - 2;
    const listRows = Math.max(1, height - (miniStatus ? 5 : 3));
    const pageRows = this.brief ? listRows * 2 : listRows;
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + pageRows) this.top = this.cursor - pageRows + 1;
    const title = ` ${fs.show ? fs.show(this.dir) : shortPath(this.dir, fs.home)} `.slice(0, inner - 2);
    const left = Math.max(1, Math.floor((inner - title.length) / 2));
    const edge = (spans: Span[]): Span[] => [{ text: '│', style: 'panel' }, ...spans, { text: '│', style: 'panel' }];
    const rows: Span[][] = [[{ text: `┌${'─'.repeat(left)}`, style: 'panel' }, { text: title, style: active ? 'cursor' : 'panel' }, { text: `${'─'.repeat(Math.max(0, inner - left - title.length))}┐`, style: 'panel' }]];
    if (aside) {
      for (let r = 0; r < height - 2; r++) rows.push(edge([{ text: fit(aside[r] ?? '', inner), style: 'panel' }]));
    } else {
      rows.push(edge(this.header(inner)), ...this.listRows(inner, listRows, active).map(edge));
      if (miniStatus) {
        const cur = this.current();
        const status = this.error ?? (this.marked.size ? `${this.marked.size} marcados` : cur?.name === '..' ? mcT('UP--DIR') : cur?.name ?? '');
        rows.push([{ text: `├${'─'.repeat(inner)}┤`, style: 'panel' }], edge([{ text: fit(status, inner), style: this.error ? 'error' : 'panel' }]));
      }
    }
    rows.push([{ text: `└${'─'.repeat(inner)}┘`, style: 'panel' }]);
    return rows;
  }
}
