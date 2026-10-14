/**
 * GNU Midnight Commander 4.8 (simplified): two panels, F3 viewer, F4 editor (nano, Ubuntu's default
 * editor), F5 copy, F6 rename/move, F7 mkdir, F8 delete, F10 quit. Esc + digit = F-key, as in mc.
 */
import { mcCredits } from './mc-credits.ts';
import type { Editor, Frame, KeyInput, Span } from './buffer.ts';
import { fit, expandTabs } from './buffer.ts';
import type { McFs } from './mc-fs.ts';
import { joinPath } from './mc-fs.ts';
import { Panel } from './mc-panel.ts';
import { dialogKey, drawDialog } from './mc-dialog.ts';
import type { Dialog } from './mc-dialog.ts';
import { NanoEditor } from './nano.ts';
import { t } from '../i18n/t.ts';
import { aboutInfo } from '../docs/about.ts';

const KEYS: readonly [string, string][] = [['1', 'Help'], ['2', 'Menu'], ['3', 'View'], ['4', 'Edit'], ['5', 'Copy'], ['6', 'RenMov'], ['7', 'Mkdir'], ['8', 'Delete'], ['9', 'PullDn'], ['10', 'Quit']];
const MENU = '  Left     File     Command     Options     Right';
function help(): string[] {
  const a = aboutInfo();
  return [t('mc.help.1'), t('mc.help.2'), t('mc.help.3'), t('mc.help.4'), t('mc.help.5'), t('mc.help.about'), '', t('mc.footer', { version: a.version, author: a.author })];
}

interface Viewer {
  readonly name: string;
  readonly lines: readonly string[];
  top: number;
}

export class McApp implements Editor {
  closed = false;
  private readonly fs: McFs;
  private readonly panels: [Panel, Panel];
  private active: 0 | 1 = 0;
  private dialog: Dialog | null = null;
  private viewer: Viewer | null = null;
  private editor: NanoEditor | null = null;
  private escPending = false;
  private height = 24;

  constructor(fs: McFs, left: string, right: string) {
    this.fs = fs;
    this.panels = [new Panel(left), new Panel(right)];
    for (const p of this.panels) p.reload(fs);
  }

  private get panel(): Panel {
    return this.panels[this.active];
  }

  private get other(): Panel {
    return this.panels[this.active === 0 ? 1 : 0];
  }

  // ------------------------------------------------------------ keys

  key(k: KeyInput): void {
    if (this.editor) { this.editorKey(k); return; }
    if (this.viewer) { this.viewerKey(this.viewer, k); return; }
    const open = this.dialog;
    if (open) {
      // a dialog's action may open another one (an error after a copy): close only the one answered
      if (dialogKey(open, k) && this.dialog === open) this.dialog = null;
      return;
    }
    if (this.escPending) {
      this.escPending = false;
      if (/^[0-9]$/.test(k.key)) { this.fkey(k.key === '0' ? 10 : Number(k.key)); return; }
    }
    if (k.key === 'Escape') { this.escPending = true; return; }
    const f = /^F(\d{1,2})$/.exec(k.key);
    if (f) { this.fkey(Number(f[1])); return; }
    this.navKey(k);
  }

  private navKey(k: KeyInput): void {
    const p = this.panel;
    const page = Math.max(1, this.height - 8);
    const c = k.key.toLowerCase();
    if (k.ctrl && c === 't') { p.toggleMark(); return; }
    if (k.ctrl && c === 'r') { this.reload(); return; }
    if (k.ctrl && (c === 'c' || c === 'g')) return;
    switch (k.key) {
      case 'ArrowUp': p.move(-1); break;
      case 'ArrowDown': p.move(1); break;
      case 'PageUp': p.move(-page); break;
      case 'PageDown': p.move(page); break;
      case 'Home': p.cursor = 0; break;
      case 'End': p.cursor = p.entries.length - 1; break;
      case 'Tab': this.active = this.active === 0 ? 1 : 0; break;
      case 'Insert': p.toggleMark(); break;
      case 'Enter': if (!p.enter(this.fs)) this.fkey(3); break;
      default: break;
    }
  }

  private fkey(n: number): void {
    const p = this.panel;
    const cur = p.current();
    switch (n) {
      case 1: this.dialog = { kind: 'message', title: t('mc.help.title'), lines: help(), error: false }; break;
      case 3: if (cur && !cur.dir) this.view(joinPath(p.dir, cur.name)); break;
      case 4: if (cur && !cur.dir) this.edit(joinPath(p.dir, cur.name)); break;
      case 5: this.transfer('copy'); break;
      case 6: this.transfer('move'); break;
      case 7: this.dialog = { kind: 'input', title: 'Create a new Directory', label: 'Enter directory name:', value: '', onOk: (v) => this.mkdir(v) }; break;
      case 8: this.remove(); break;
      // No user menu nor pull-down menus here: F2 / F9 show the credits in the (scrollable) viewer.
      case 2: case 9: this.viewer = { name: t('mc.about.title'), lines: mcCredits(), top: 0 }; break;
      case 10: this.dialog = { kind: 'confirm', title: 'The Midnight Commander', text: 'Do you really want to quit the Midnight Commander?', yes: true, onYes: () => { this.closed = true; } }; break;
      default: break;
    }
  }

  // ------------------------------------------------------------ operations

  private reload(): void {
    for (const p of this.panels) p.reload(this.fs, p.current()?.name);
  }

  private fail(err: string | null, title = 'Error'): void {
    this.reload();
    if (err) this.dialog = { kind: 'message', title, lines: err.split('\n'), error: true };
  }

  private transfer(op: 'copy' | 'move'): void {
    const names = this.panel.selection();
    if (!names.length) return;
    const what = names.length === 1 ? `"${names[0]}"` : `${names.length} files/directories`;
    const title = op === 'copy' ? 'Copy' : 'Move';
    this.dialog = {
      kind: 'input', title, label: `${op === 'copy' ? 'Copy' : 'Move'} ${what} to:`, value: `${this.other.dir.replace(/\/?$/, '/')}`,
      onOk: (target) => {
        const sources = names.map((n) => joinPath(this.panel.dir, n));
        const err = op === 'copy' ? this.fs.copy(sources, target) : this.fs.move(sources, target);
        this.panel.marked.clear();
        this.fail(err);
      },
    };
  }

  private mkdir(name: string): void {
    if (!name.trim()) return;
    const path = name.startsWith('/') ? name : joinPath(this.panel.dir, name.trim());
    const err = this.fs.mkdir(path);
    this.fail(err);
    if (!err) this.panel.reload(this.fs, name.trim().split('/').pop());
  }

  private remove(): void {
    const names = this.panel.selection();
    if (!names.length) return;
    const text = names.length === 1 ? `Delete file "${names[0]}"?` : `Delete ${names.length} files/directories?`;
    this.dialog = {
      kind: 'confirm', title: 'Delete', text, yes: true,
      onYes: () => {
        const err = this.fs.remove(names.map((n) => joinPath(this.panel.dir, n)));
        this.panel.marked.clear();
        this.fail(err);
      },
    };
  }

  private view(path: string): void {
    const r = this.fs.read(path);
    if (typeof r !== 'string') { this.fail(`Cannot open "${path}" for reading\n${r.error}`); return; }
    this.viewer = { name: path, lines: r.split('\n').map(expandTabs), top: 0 };
  }

  private viewerKey(v: Viewer, k: KeyInput): void {
    const page = Math.max(1, this.height - 2);
    const max = Math.max(0, v.lines.length - page);
    if (['F3', 'F10', 'Escape', 'q'].includes(k.key)) this.viewer = null;
    else if (k.key === 'ArrowDown' || k.key === 'Enter') v.top = Math.min(max, v.top + 1);
    else if (k.key === 'ArrowUp') v.top = Math.max(0, v.top - 1);
    else if (k.key === 'PageDown' || k.key === ' ') v.top = Math.min(max, v.top + page);
    else if (k.key === 'PageUp' || k.key === 'b') v.top = Math.max(0, v.top - page);
    else if (k.key === 'Home') v.top = 0;
    else if (k.key === 'End') v.top = max;
  }

  private edit(path: string): void {
    const r = this.fs.read(path);
    if (typeof r !== 'string') { this.fail(`Cannot open "${path}" for reading\n${r.error}`); return; }
    this.editor = new NanoEditor({ editor: 'nano', path, content: r, exists: true, readOnly: false }, { save: (p, c) => this.fs.write(p, c) });
  }

  private editorKey(k: KeyInput): void {
    this.editor?.key(k);
    if (this.editor?.closed) {
      this.editor = null;
      this.reload();
    }
  }

  // ------------------------------------------------------------ screen

  frame(width: number, height: number): Frame {
    this.height = height;
    if (this.editor) return this.editor.frame(width, height);
    if (this.viewer) return this.viewerFrame(this.viewer, width, height);
    const panelH = Math.max(6, height - 3);
    const leftW = Math.floor(width / 2);
    const left = this.panels[0].render(leftW, panelH, this.active === 0, this.fs.home);
    const right = this.panels[1].render(width - leftW, panelH, this.active === 1, this.fs.home);
    const rows: Span[][] = [[{ text: fit(MENU, width), style: 'menu' }]];
    for (let i = 0; i < panelH; i++) rows.push([...(left[i] ?? []), ...(right[i] ?? [])]);
    const prompt = this.fs.prompt(this.panel.dir);
    rows.push([{ text: fit(prompt, width) }]);
    rows.push(this.keyBar(width));
    const cursor = this.dialog ? drawDialog(this.dialog, rows, width) : { row: height - 2, col: Math.min(width - 1, prompt.length) };
    return { rows: rows.slice(0, height), cursor };
  }

  private keyBar(width: number): Span[] {
    const cell = Math.max(4, Math.floor(width / KEYS.length));
    const spans: Span[] = [];
    for (const [n, label] of KEYS) {
      spans.push({ text: n, style: 'keynum' }, { text: fit(label, cell - n.length), style: 'keylabel' });
    }
    return spans;
  }

  private viewerFrame(v: Viewer, width: number, height: number): Frame {
    const body = height - 2;
    const pct = v.lines.length <= body ? 100 : Math.round(((v.top + body) * 100) / v.lines.length);
    const head = `${v.name}`.slice(0, width - 22);
    const rows: Span[][] = [[{ text: fit(`${head}  Line: ${v.top + 1}/${v.lines.length}  ${Math.min(100, pct)}%`, width), style: 'menu' }]];
    for (let i = 0; i < body; i++) rows.push([{ text: fit(v.lines[v.top + i] ?? '', width), style: 'viewer' }]);
    rows.push(this.keyBar(width).map((s) => (s.text.trim() === 'View' ? { ...s, text: fit('Quit', s.text.length) } : s)));
    return { rows, cursor: null };
  }
}
