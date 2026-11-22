/**
 * Midnight Commander's directory tree (Left/Right › Tree): the folders from the top one (/ or C:\) down, the ones on
 * the way to where mc started open. ↑↓ move, → (or +) opens a folder, ← (or -) closes it or goes to its parent; the
 * other panel shows what the folder under the cursor holds.
 */
import type { KeyInput, Span } from './buffer.ts';
import { fit } from './buffer.ts';
import type { McFs } from './mc-fs.ts';
import { joinPath } from './mc-fs.ts';

/** Folders listed at most, and how deep (a huge disk stays responsive). */
const MAX_NODES = 2000;
const MAX_DEPTH = 32;

interface TreeNode {
  readonly path: string;
  readonly name: string;
  /** The lines before the name: "│ ├─", "  └─"… */
  readonly prefix: string;
}

export class DirTree {
  readonly root: string;
  readonly expanded = new Set<string>();
  nodes: TreeNode[] = [];
  cursor = 0;
  private top = 0;

  private readonly start: string;

  /** The tree from `root`, open down to `start` (its folders show too), its cursor on `start` once refreshed. */
  constructor(root: string, start: string) {
    this.root = root;
    this.start = start;
    this.expanded.add(root);
    this.expanded.add(start);
    for (let p = start; p !== root && p !== '/'; ) {
      p = this.parentOf(p);
      this.expanded.add(p);
    }
  }

  private parentOf(path: string): string {
    return path === this.root ? this.root : path.replace(/\/[^/]*$/, '') || '/';
  }

  get selected(): string {
    return this.nodes[this.cursor]?.path ?? this.start;
  }

  /** Reads the open folders again, keeping the cursor on `keep` (or the nearest folder above it that shows). */
  refresh(fs: McFs, hidden: boolean, keep = this.selected): void {
    const nodes: TreeNode[] = [{ path: this.root, name: fs.show ? fs.show(this.root) : this.root, prefix: '' }];
    const walk = (dir: string, prefix: string, depth: number): void => {
      if (!this.expanded.has(dir) || depth >= MAX_DEPTH) return;
      const listed = fs.list(dir);
      if (typeof listed === 'string') return;
      const dirs = listed.filter((e) => e.dir && (hidden || !e.name.startsWith('.'))).map((e) => e.name).sort((a, b) => a.localeCompare(b));
      dirs.forEach((name, i) => {
        if (nodes.length >= MAX_NODES) return;
        const last = i === dirs.length - 1;
        const path = joinPath(dir, name);
        nodes.push({ path, name, prefix: `${prefix}${last ? '└─' : '├─'}` });
        walk(path, `${prefix}${last ? '  ' : '│ '}`, depth + 1);
      });
    };
    walk(this.root, '', 0);
    this.nodes = nodes;
    let at = nodes.findIndex((n) => n.path === keep);
    for (let p = keep; at < 0 && p !== this.root; p = this.parentOf(p)) at = nodes.findIndex((n) => n.path === this.parentOf(p));
    this.cursor = Math.max(0, at);
  }

  /** A key on the tree; true when it took it (the other panel then follows the cursor). */
  key(k: KeyInput, fs: McFs, hidden: boolean, page: number): boolean {
    const n = this.nodes.length;
    const go = (i: number): boolean => { this.cursor = Math.max(0, Math.min(n - 1, i)); return true; };
    const sel = this.selected;
    switch (k.key) {
      case 'ArrowUp': return go(this.cursor - 1);
      case 'ArrowDown': return go(this.cursor + 1);
      case 'PageUp': return go(this.cursor - page);
      case 'PageDown': return go(this.cursor + page);
      case 'Home': return go(0);
      case 'End': return go(n - 1);
      case 'ArrowRight': case '+': this.expanded.add(sel); this.refresh(fs, hidden, sel); return true;
      case 'ArrowLeft': case '-':
        if (this.expanded.has(sel) && sel !== this.root) { this.expanded.delete(sel); this.refresh(fs, hidden, sel); }
        else this.refresh(fs, hidden, this.parentOf(sel));
        return true;
      default: return false;
    }
  }

  /** The rows between the panel's borders: `rows` high, `width` wide. */
  rows(width: number, rows: number, active: boolean): Span[][] {
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + rows) this.top = this.cursor - rows + 1;
    const out: Span[][] = [];
    for (let r = 0; r < rows; r++) {
      const i = this.top + r;
      const node = this.nodes[i];
      if (!node) { out.push([{ text: ' '.repeat(width), style: 'panel' }]); continue; }
      const style = i === this.cursor ? (active ? 'cursor' : 'marked') : 'dir';
      out.push([{ text: node.prefix.slice(0, width), style: 'panel' }, { text: fit(node.name, Math.max(0, width - node.prefix.length)), style }]);
    }
    return out;
  }
}
