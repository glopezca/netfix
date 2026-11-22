/**
 * GNU Midnight Commander 4.8: two panels, the menu bar (F9: Left, File, Command, Options, Right; mc-menu.ts, what each
 * item does in mc-commands.ts) and the key bar (F1 help, F2 user menu, F3 viewer, F4 editor — nano, or the host's
 * editor program as with $EDITOR, which also opens a text file on Enter —, F5 copy, F6 rename/move, F7 mkdir, F8
 * delete, F9 menus, F10 quit), with mc's shortcuts (C-x c, M-c…; Esc + key = Alt + key, Esc + digit = F-key) and
 * texts (Spanish when Netfix is). Alt+, splits the panels top and bottom or side by side, as Options › Layout does. What
 * is typed goes to the command line under the panels, and Enter runs it in the shell from the active panel's folder.
 */
import { mcCredits } from './mc-credits.ts';
import type { Editor, Frame, KeyInput, Span } from './buffer.ts';
import { fit, expandTabs } from './buffer.ts';
import type { McFs } from './mc-fs.ts';
import { joinPath } from './mc-fs.ts';
import { Panel } from './mc-panel.ts';
import { dialogKey, drawDialog } from './mc-dialog.ts';
import type { Dialog } from './mc-dialog.ts';
import { drawMenu, menuBar, menuKey, type McAction, type MenuState } from './mc-menu.ts';
import { asideLines, ctrlXAction, keyAction, runAction } from './mc-commands.ts';
import { loadSetup, saveSetup, type McSetup } from './mc-setup.ts';
import { mcFormat, mcQ, mcT } from './mc-i18n.ts';
import { NanoEditor } from './nano.ts';
import { t } from '../i18n/t.ts';
import { aboutInfo } from '../docs/about.ts';

const KEYS: readonly [string, string][] = [['1', 'Help'], ['2', 'Menu'], ['3', 'View'], ['4', 'Edit'], ['5', 'Copy'], ['6', 'RenMov'], ['7', 'Mkdir'], ['8', 'Delete'], ['9', 'PullDn'], ['10', 'Quit']];
const NO_DRIVE = 'The system cannot find the drive specified.';

/** F1: Netfix's help, then the credits of Netfix and GNU Midnight Commander. */
function help(): string[] {
  const a = aboutInfo();
  return [t('mc.help.1'), t('mc.help.2'), t('mc.help.3'), t('mc.help.4'), t('mc.help.5'), t('mc.help.about'), '', t('mc.footer', { version: a.version, author: a.author }), '', ...mcCredits()];
}

interface Viewer {
  readonly name: string;
  readonly lines: readonly string[];
  top: number;
}

export class McApp implements Editor {
  closed = false;
  readonly fs: McFs;
  panels: [Panel, Panel];
  active: 0 | 1 = 0;
  dialog: Dialog | null = null;
  viewer: Viewer | null = null;
  menu: MenuState | null = null;
  setup: McSetup;
  /** The setup changed since mc started: Auto save setup writes it on quitting. */
  dirty = false;
  /** The command line's text, and the output of the line it ran (shown until a key is pressed). */
  line = '';
  output: readonly string[] | null = null;
  lastOutput: readonly string[] = [];
  readonly history: string[] = [];
  readonly fileHistory: string[] = [];
  readonly hotlist: string[] = [];
  private editor: NanoEditor | null = null;
  private escPending = false;
  private ctrlXPending = false;
  private height = 24;

  constructor(fs: McFs, left: string, right: string) {
    this.fs = fs;
    this.setup = loadSetup(fs);
    this.panels = [new Panel(left), new Panel(right)];
    this.applyPanelOptions();
  }

  get panel(): Panel {
    return this.panels[this.active];
  }

  get other(): Panel {
    return this.panels[this.active === 0 ? 1 : 0];
  }

  /** Options › Panel options reach both panels; then both are read again. */
  applyPanelOptions(): void {
    for (const p of this.panels) { p.hidden = this.setup.showDotFiles; p.mix = this.setup.mixAllFiles; }
    this.reload();
  }

  changeSetup(next: Partial<McSetup>): void {
    this.setup = { ...this.setup, ...next };
    this.dirty = true;
    this.applyPanelOptions();
  }

  // ------------------------------------------------------------ keys

  key(k: KeyInput): void {
    if (this.editor) { this.editorKey(k); return; }
    if (this.viewer) { this.viewerKey(this.viewer, k); return; }
    if (this.output) { this.output = null; return; }
    const open = this.dialog;
    if (open) {
      // a dialog's action may open another one (an error after a copy): close only the one answered
      if (dialogKey(open, k) && this.dialog === open) this.dialog = null;
      return;
    }
    if (this.menu) { this.menuKey(this.menu, k); return; }
    if (this.prefixKey(k)) return;
    const f = /^F(\d{1,2})$/.exec(k.key);
    if (f) { this.fkey(Number(f[1])); return; }
    const action = keyAction(k, this.line === '');
    if (action) { this.act(action); return; }
    this.navKey(k);
  }

  /** Esc then a key (= Alt + it; a digit = an F-key) and C-x then a key. */
  private prefixKey(k: KeyInput): boolean {
    if (this.ctrlXPending) {
      this.ctrlXPending = false;
      const a = ctrlXAction(k);
      // C-x q / C-x i: the other panel shows the active panel's entry (the menus name their own panel)
      if (a) this.act(a, a === 'quickView' || a === 'info' ? (this.active === 0 ? 1 : 0) : this.active);
      return true;
    }
    if (this.escPending) {
      this.escPending = false;
      if (/^[0-9]$/.test(k.key)) { this.fkey(k.key === '0' ? 10 : Number(k.key)); return true; }
      if (k.key !== 'Escape') this.key({ ...k, alt: true });
      return true;
    }
    if (k.key === 'Escape') { this.escPending = true; return true; }
    if (k.ctrl && !k.alt && k.key.toLowerCase() === 'x') { this.ctrlXPending = true; return true; }
    return false;
  }

  private menuKey(st: MenuState, k: KeyInput): void {
    const r = menuKey(st, k);
    this.menu = r.state;
    if (r.item) this.act(r.item.action, st.menu === 4 ? 1 : st.menu === 0 ? 0 : this.active);
  }

  /** What a menu item or shortcut does, on the active panel or (Left/Right menus) the one named. */
  act(action: McAction, side: 0 | 1 = this.active): void {
    runAction(this, action, side);
  }

  private navKey(k: KeyInput): void {
    if (this.commandKey(k)) return;
    const p = this.panel;
    const page = Math.max(1, this.height - 8);
    const c = k.key.toLowerCase();
    if (k.ctrl && c === 't') { p.toggleMark(this.setup.markMovesDown); return; }
    if (k.ctrl && (c === 'c' || c === 'g')) return;
    switch (k.key) {
      case 'ArrowUp': p.move(-1); break;
      case 'ArrowDown': p.move(1); break;
      case 'PageUp': p.move(-page); break;
      case 'PageDown': p.move(page); break;
      case 'Home': p.cursor = 0; break;
      case 'End': p.cursor = p.entries.length - 1; break;
      case 'Tab': if (this.other.mode === 'list') this.active = this.active === 0 ? 1 : 0; break;
      case 'Insert': p.toggleMark(this.setup.markMovesDown); break;
      case 'Enter': if (!p.enter(this.fs)) this.fkey(this.fs.edit && p.current()?.exec === false ? 4 : 3); break; // a host editor opens text files
      default: break;
    }
  }

  /** Typing, Backspace and Enter on the command line (only where the shell can run it and the line shows). */
  private commandKey(k: KeyInput): boolean {
    if (!this.fs.run || !this.setup.commandPrompt || k.ctrl || k.alt) return false;
    if (k.key.length === 1) this.line += k.key;
    else if (k.key === 'Backspace' && this.line) this.line = this.line.slice(0, -1);
    else if (k.key === 'Enter' && this.line.trim()) this.runLine(this.fs.run);
    else return false;
    return true;
  }

  private runLine(run: NonNullable<McFs['run']>): void {
    const echo = `${this.fs.prompt(this.panel.dir)}${this.line}`;
    this.history.push(this.line);
    const r = run(this.line, this.panel.dir);
    this.line = '';
    this.panel.dir = r.dir;
    this.reload();
    this.lastOutput = [echo, ...r.lines];
    if (r.lines.length > 0) this.output = this.lastOutput;
  }

  fkey(n: number): void {
    const p = this.panel;
    const cur = p.current();
    switch (n) {
      case 1: this.viewer = { name: t('mc.help.title'), lines: help(), top: 0 }; break;
      case 2: this.act('userMenu'); break;
      case 3: if (cur && !cur.dir) this.view(joinPath(p.dir, cur.name)); break;
      case 4: if (cur && !cur.dir) this.edit(joinPath(p.dir, cur.name)); break;
      case 5: this.transfer('copy'); break;
      case 6: this.transfer('move'); break;
      case 7: this.dialog = { kind: 'input', title: mcT('Create a new Directory'), label: mcT('Enter directory name:'), value: '', onOk: (v) => this.mkdir(v) }; break;
      case 8: this.remove(); break;
      case 9: this.menu = { menu: this.active === 0 ? 0 : 4, item: 0 }; break;
      case 10: this.quit(); break;
      default: break;
    }
  }

  private quit(): void {
    const done = (): void => {
      if (this.dirty && this.setup.autoSaveSetup) saveSetup(this.fs, this.setup);
      this.closed = true;
    };
    if (!this.setup.confirmExit) { done(); return; }
    this.dialog = { kind: 'confirm', title: mcT('The Midnight Commander'), text: mcT('Do you really want to quit the Midnight Commander?'), yes: true, onYes: done };
  }

  // ------------------------------------------------------------ operations

  reload(): void {
    for (const p of this.panels) p.reload(this.fs, p.current()?.name);
  }

  fail(err: string | null, title = mcT('Error')): void {
    this.reload();
    if (err) this.dialog = { kind: 'message', title, lines: err.split('\n'), error: true };
  }

  private what(names: readonly string[]): string {
    return names.length === 1 ? `"${names[0]}"` : `${names.length} ${mcT('files/directories')}`;
  }

  private transfer(op: 'copy' | 'move'): void {
    const names = this.panel.selection();
    if (!names.length) return;
    this.dialog = {
      kind: 'input', title: mcQ(op === 'copy' ? 'DialogTitle|Copy' : 'DialogTitle|Move'), label: mcFormat(mcT(op === 'copy' ? 'Copy %s to:' : 'Move %s to:'), this.what(names)),
      value: this.folderText(this.other.dir),
      onOk: (target) => {
        const sources = names.map((n) => joinPath(this.panel.dir, n));
        const to = this.typed(target);
        const err = to === null ? NO_DRIVE : op === 'copy' ? this.fs.copy(sources, to) : this.fs.move(sources, to);
        this.panel.marked.clear();
        this.fail(err);
      },
    };
  }

  private mkdir(name: string): void {
    if (!name.trim()) return;
    const path = this.typed(name);
    const err = path === null ? NO_DRIVE : this.fs.mkdir(path);
    this.fail(err);
    if (!err) this.panel.reload(this.fs, name.trim().split(/[\\/]/).pop());
  }

  private remove(): void {
    const names = this.panel.selection();
    if (!names.length) return;
    const doIt = (): void => {
      const err = this.fs.remove(names.map((n) => joinPath(this.panel.dir, n)));
      this.panel.marked.clear();
      this.fail(err);
    };
    if (!this.setup.confirmDelete) { doIt(); return; }
    this.dialog = { kind: 'confirm', title: mcQ('DialogTitle|Delete'), text: mcFormat(mcT('Delete %s?'), this.what(names)), yes: true, onYes: doIt };
  }

  shown(path: string): string {
    return this.fs.show ? this.fs.show(path) : path;
  }

  /** A folder as typed in a dialog, ending in its separator (/ or \\). */
  folderText(dir: string): string {
    const shown = this.shown(dir);
    return this.fs.show ? (shown.endsWith('\\') ? shown : `${shown}\\`) : shown.replace(/\/?$/, '/');
  }

  /** The path typed in a dialog, as the file system takes it (GNU/Linux: ~ is the home, relative from the panel). */
  typed(text: string): string | null {
    const s = text.trim();
    if (this.fs.parse) return this.fs.parse(s, this.panel.dir);
    if (s === '~' || s.startsWith('~/')) return this.fs.home + s.slice(1);
    return s.startsWith('/') ? s : joinPath(this.panel.dir, s);
  }

  private remember(path: string): void {
    const i = this.fileHistory.indexOf(path);
    if (i >= 0) this.fileHistory.splice(i, 1);
    this.fileHistory.push(path);
  }

  private cannotOpen(path: string, error: string): void {
    this.fail(`${mcFormat(mcT('Cannot open %s for reading'), `"${this.shown(path)}"`)}\n${error}`);
  }

  view(path: string): void {
    const r = this.fs.read(path);
    if (typeof r !== 'string') { this.cannotOpen(path, r.error); return; }
    this.remember(path);
    this.viewer = { name: this.shown(path), lines: r.split('\n').map(expandTabs), top: 0 };
  }

  /** A text in the viewer (a command's output, a comparison). */
  show(name: string, lines: readonly string[]): void {
    this.viewer = { name, lines: lines.map(expandTabs), top: 0 };
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

  /** F4: the host's editor program (as $EDITOR, unless Use internal edit is on) or nano; `create` opens a new file empty. */
  edit(path: string, create = false): void {
    if (this.fs.edit && !this.setup.useInternalEdit) { // the host's editor program: it takes the file, mc stays on its panels
      const err = this.fs.edit(path);
      if (err) this.fail(err);
      else this.remember(path);
      return;
    }
    const r = this.fs.read(path);
    if (typeof r !== 'string' && !create) { this.cannotOpen(path, r.error); return; }
    this.remember(path);
    // nano shows and takes paths as the system writes them (C:\... on Windows).
    const save = (p: string, c: string): string | null => {
      const to = this.fs.parse ? this.fs.parse(p, this.panel.dir) : p;
      return to === null ? NO_DRIVE : this.fs.write(to, c);
    };
    this.editor = new NanoEditor({ editor: 'nano', path: this.shown(path), content: typeof r === 'string' ? r : '', exists: typeof r === 'string', readOnly: false }, { save });
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
    if (this.output) return this.outputFrame(this.output, width, height);
    const s = this.setup;
    const bar = s.menubarVisible || this.menu !== null;
    const rows: Span[][] = bar ? [menuBar(width, this.menu)] : [];
    rows.push(...this.panelRows(width, Math.max(6, height - Number(bar) - Number(s.commandPrompt) - Number(s.keybarVisible))));
    const prompt = this.fs.prompt(this.panel.dir);
    if (s.commandPrompt) rows.push([{ text: fit(prompt + this.line, width) }]);
    if (s.keybarVisible) rows.push(this.keyBar(width));
    if (this.menu) drawMenu(rows, this.menu, width);
    const cursor = this.dialog ? drawDialog(this.dialog, rows, width)
      : s.commandPrompt && !this.menu ? { row: rows.length - 1 - Number(s.keybarVisible), col: Math.min(width - 1, prompt.length + this.line.length) } : null;
    return { rows: rows.slice(0, height), cursor };
  }

  /** Both panels in `height` rows: side by side, or one over the other (the top one gets the odd row). */
  private panelRows(width: number, height: number): Span[][] {
    const draw = (i: 0 | 1, w: number, h: number): Span[][] => this.panels[i].render(w, h, this.active === i, this.fs, asideLines(this, i), this.setup.showMiniInfo);
    if (this.setup.horizontalSplit) {
      const topH = Math.ceil(height / 2);
      return [...draw(0, width, topH), ...draw(1, width, height - topH)];
    }
    const leftW = Math.floor(width / 2);
    const right = draw(1, width - leftW, height);
    return draw(0, leftW, height).map((row, i) => [...row, ...(right[i] ?? [])]);
  }

  private keyBar(width: number, labels: (key: string) => string = (k) => mcQ(`ButtonBar|${k}`)): Span[] {
    const cell = Math.max(4, Math.floor(width / KEYS.length));
    const spans: Span[] = [];
    for (const [n, label] of KEYS) spans.push({ text: n, style: 'keynum' }, { text: fit(labels(label), cell - n.length), style: 'keylabel' });
    return spans;
  }

  /** The output of a command-line line, as the terminal shows it, until a key brings the panels back. */
  private outputFrame(lines: readonly string[], width: number, height: number): Frame {
    const shown = [...lines.flatMap((l) => expandTabs(l).split('\n')), mcT('Press any key to continue...')].slice(-height);
    return { rows: shown.map((l) => [{ text: l.slice(0, width) }]), cursor: null };
  }

  private viewerFrame(v: Viewer, width: number, height: number): Frame {
    const body = height - 2;
    const pct = v.lines.length <= body ? 100 : Math.round(((v.top + body) * 100) / v.lines.length);
    const head = `${v.name}`.slice(0, width - 22);
    const rows: Span[][] = [[{ text: fit(`${head}  Line: ${v.top + 1}/${v.lines.length}  ${Math.min(100, pct)}%`, width), style: 'menu' }]];
    for (let i = 0; i < body; i++) rows.push([{ text: fit(v.lines[v.top + i] ?? '', width), style: 'viewer' }]);
    rows.push(this.keyBar(width, (k) => mcQ(`ButtonBar|${k === 'View' ? 'Quit' : k}`)));
    return { rows, cursor: null };
  }
}
