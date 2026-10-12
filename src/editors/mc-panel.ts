/** One Midnight Commander panel: directory listing, cursor, marked files and its drawing. */
import type { Span } from './buffer.ts';
import { fit } from './buffer.ts';
import type { McEntry, McFs } from './mc-fs.ts';
import { joinPath, shortPath } from './mc-fs.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIZE_W = 7;
const TIME_W = 12;

export function mcTime(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

function humanSize(n: number): string {
  if (n < 1_000_000) return String(n);
  return `${Math.round(n / 1024)}K`;
}

export class Panel {
  dir: string;
  entries: McEntry[] = [];
  cursor = 0;
  top = 0;
  readonly marked = new Set<string>();
  error: string | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Re-reads the directory, keeping the cursor on `keep` when it still exists. */
  reload(fs: McFs, keep?: string): void {
    const listed = fs.list(this.dir);
    if (typeof listed === 'string') {
      this.error = listed;
      this.entries = [{ name: '..', dir: true, link: false, exec: false, size: 4096, mtime: 0 }];
    } else {
      this.error = null;
      const sorted = [...listed].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      this.entries = this.dir === '/' ? sorted : [{ name: '..', dir: true, link: false, exec: false, size: 4096, mtime: 0 }, ...sorted];
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

  toggleMark(): void {
    const cur = this.current();
    if (!cur || cur.name === '..') return;
    if (this.marked.has(cur.name)) this.marked.delete(cur.name);
    else this.marked.add(cur.name);
    this.move(1);
  }

  /** Enters the directory under the cursor (".." goes up). */
  enter(fs: McFs): boolean {
    const cur = this.current();
    if (!cur?.dir) return false;
    const from = this.dir;
    this.dir = joinPath(this.dir, cur.name);
    this.marked.clear();
    this.cursor = 0;
    this.top = 0;
    this.reload(fs, cur.name === '..' ? from.split('/').pop() : undefined);
    return true;
  }

  private nameStyle(e: McEntry, i: number, active: boolean): Span['style'] {
    if (active && i === this.cursor) return 'cursor';
    if (this.marked.has(e.name)) return 'marked';
    if (e.dir) return 'dir';
    if (e.link) return 'link';
    return e.exec ? 'exec' : 'panel';
  }

  private row(e: McEntry, i: number, width: number, active: boolean): Span[] {
    const nameW = Math.max(4, width - SIZE_W - TIME_W - 2);
    const prefix = e.dir ? '/' : e.link ? '@' : e.exec ? '*' : ' ';
    const size = e.name === '..' ? 'UP--DIR' : e.dir ? 'DIR' : humanSize(e.size);
    const style = this.nameStyle(e, i, active);
    const time = e.name === '..' ? '' : mcTime(e.mtime);
    return [{ text: '│', style: 'panel' }, { text: `${fit(prefix + e.name, nameW)}│${size.padStart(SIZE_W)}│${fit(time, TIME_W)}`, style }, { text: '│', style: 'panel' }];
  }

  /** Rows of the panel (borders included), `height` rows high. */
  render(width: number, height: number, active: boolean, home: string): Span[][] {
    const inner = width - 2;
    const listRows = Math.max(1, height - 5);
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + listRows) this.top = this.cursor - listRows + 1;
    const title = ` ${shortPath(this.dir, home)} `.slice(0, inner - 2);
    const left = Math.max(1, Math.floor((inner - title.length) / 2));
    const rows: Span[][] = [[{ text: `┌${'─'.repeat(left)}`, style: 'panel' }, { text: title, style: active ? 'cursor' : 'panel' }, { text: `${'─'.repeat(Math.max(0, inner - left - title.length))}┐`, style: 'panel' }]];
    const nameW = Math.max(4, inner - SIZE_W - TIME_W - 2);
    rows.push([{ text: '│', style: 'panel' }, { text: `${fit('.n   Name', nameW)}│${fit('  Size', SIZE_W)}│${fit('Modify time', TIME_W)}`, style: 'panelHead' }, { text: '│', style: 'panel' }]);
    for (let r = 0; r < listRows; r++) {
      const i = this.top + r;
      const e = this.entries[i];
      rows.push(e ? this.row(e, i, inner, active) : [{ text: `│${' '.repeat(inner)}│`, style: 'panel' }]);
    }
    const cur = this.current();
    const status = this.error ?? (this.marked.size ? `${this.marked.size} marcados` : cur?.name === '..' ? 'UP--DIR' : cur?.name ?? '');
    rows.push([{ text: `├${'─'.repeat(inner)}┤`, style: 'panel' }]);
    rows.push([{ text: '│', style: 'panel' }, { text: fit(status, inner), style: this.error ? 'error' : 'panel' }, { text: '│', style: 'panel' }]);
    rows.push([{ text: `└${'─'.repeat(inner)}┘`, style: 'panel' }]);
    return rows;
  }
}
