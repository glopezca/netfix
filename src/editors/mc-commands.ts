/**
 * What Midnight Commander's menu items and shortcuts do (mc-menu.ts lists them). File operations go through the user's
 * shell (McFs), so permissions are the user's. What has nothing to act on in Netfix — remote links, encodings,
 * background jobs, skins, learning keys… — answers with mc's own "Not implemented yet".
 */
import type { KeyInput } from './buffer.ts';
import { expandTabs } from './buffer.ts';
import type { McApp } from './mc.ts';
import type { McOption } from './mc-dialog.ts';
import { joinPath } from './mc-fs.ts';
import { MC_MENUS, type McAction } from './mc-menu.ts';
import { humanSize, mcTime, type Panel, type SortKey } from './mc-panel.ts';
import { iniDir, iniPath, saveSetup } from './mc-setup.ts';
import { hotLabel, mcFormat, mcT } from './mc-i18n.ts';

const MAX_SIZE_NODES = 5000;
const QUICK_LINES = 200;

const sq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
const label = (a: McAction): string => {
  for (const m of MC_MENUS) for (const x of m.items) if (x?.action === a) return hotLabel(mcT(x.label)).text.replace(/\.\.\.$/, '');
  return '';
};

/** Alt (or Esc then) and Ctrl shortcuts on the panels; + \ * only while the command line is empty. */
export function keyAction(k: KeyInput, lineEmpty: boolean): McAction | null {
  if (k.alt) {
    if (k.key === ',' || k.code === 'Comma') return 'split';
    const alt: Readonly<Record<string, McAction>> = { c: 'quickCd', '?': 'find', h: 'history', E: 'fileHistory', e: 'encoding', '`': 'screens', '!': 'filtered' };
    return alt[k.key] ?? null;
  }
  if (k.ctrl) {
    const ctrl: Readonly<Record<string, McAction>> = { u: 'swap', o: 'panelsOnOff', r: 'rescan', ' ': 'dirSizes', '\\': 'hotlist' };
    return ctrl[k.key.toLowerCase()] ?? null;
  }
  const plain: Readonly<Record<string, McAction>> = { '+': 'select', '\\': 'unselect', '*': 'invert' };
  return lineEmpty ? plain[k.key] ?? null : null;
}

/** The key after C-x. */
export function ctrlXAction(k: KeyInput): McAction | null {
  const c = k.key.toLowerCase();
  if (k.ctrl) return c === 's' ? 'editSymlink' : c === 'd' ? 'compareFiles' : null;
  const map: Readonly<Record<string, McAction>> = { c: 'chmod', l: 'link', s: 'symlink', v: 'relSymlink', o: 'chown', d: 'compareDirs', '!': 'extPanelize', a: 'vfsList', j: 'jobs', q: 'quickView', i: 'info' };
  return map[c] ?? null;
}

/** What a panel in Info or Quick view mode shows: the entry under the other panel's cursor. */
export function asideLines(app: McApp, i: 0 | 1): string[] | null {
  const p = app.panels[i];
  if (p.mode === 'list') return null;
  const o = app.panels[i === 0 ? 1 : 0];
  const e = o.current();
  if (!e) return [];
  if (p.mode === 'info') {
    return [mcFormat(mcT('File: %s'), e.name), '', mcFormat(mcT('Size:       %s'), e.dir ? mcT('DIR') : humanSize(e.size)),
      mcFormat(mcT('Modified:   %s'), mcTime(e.mtime)), mcFormat(mcT('Type:       %s'), e.dir ? 'directory' : e.link ? 'symlink' : 'file')];
  }
  if (e.dir) return [];
  const r = app.fs.read(joinPath(o.dir, e.name));
  return typeof r === 'string' ? r.split('\n').slice(0, QUICK_LINES).map(expandTabs) : [r.error];
}

const notYet = (app: McApp, a: McAction): void => { app.dialog = { kind: 'message', title: label(a), lines: [mcT('Not implemented yet')], error: false }; };

function input(app: McApp, title: string, text: string, value: string, onOk: (v: string) => void): void {
  app.dialog = { kind: 'input', title, label: text, value, onOk };
}

function options(app: McApp, title: string, opts: McOption[], onOk: (on: readonly boolean[]) => void): void {
  app.dialog = { kind: 'options', title, options: opts, cursor: Math.max(0, opts.findIndex((o) => o.kind !== 'heading')), onOk };
}

const check = (lbl: string, on: boolean): McOption => ({ label: lbl, kind: 'check', on });
const radio = (lbl: string, group: string, on: boolean): McOption => ({ label: lbl, kind: 'radio', group, on });
const heading = (lbl: string): McOption => ({ label: lbl, kind: 'heading', on: false });

/** A file utility as the user (GNU/Linux); Windows' mc has none of them here. */
function exec(app: McApp, a: McAction, argv: readonly string[]): void {
  if (!app.fs.exec) { notYet(app, a); return; }
  app.panel.marked.clear();
  app.fail(app.fs.exec(argv));
}

/** A line run in the shell from the active panel's folder, its output in the viewer under `title`. */
function shellView(app: McApp, a: McAction, title: string, line: string): void {
  const run = app.fs.run;
  if (!run) { notYet(app, a); return; }
  const r = run(line, app.panel.dir);
  app.show(title, r.lines.length ? r.lines : ['']);
}

const curPath = (p: Panel): string | null => { const e = p.current(); return e && e.name !== '..' ? joinPath(p.dir, e.name) : null; };

function relative(fromDir: string, to: string): string {
  const a = fromDir.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

function links(app: McApp, a: McAction): void {
  const src = curPath(app.panel);
  const name = app.panel.current()?.name ?? '';
  if (!src) return;
  if (!app.fs.exec) { notYet(app, a); return; }
  const into = app.folderText(app.other.dir) + name;
  if (a === 'link') { input(app, mcT('Link'), mcFormat(mcT('Link %s to:'), `"${name}"`), into, (v) => { const to = app.typed(v); if (to) exec(app, a, ['ln', '--', src, to]); }); return; }
  input(app, mcT('Symbolic link'), mcT('Symbolic link filename:'), into, (v) => {
    const to = app.typed(v);
    if (!to) return;
    const target = a === 'relSymlink' ? relative(to.replace(/\/[^/]*$/, '') || '/', src) : src;
    exec(app, a, ['ln', '-s', '--', target, to]);
  });
}

function editSymlink(app: McApp): void {
  const e = app.panel.current();
  const path = curPath(app.panel);
  if (!app.fs.exec || !app.fs.run) { notYet(app, 'editSymlink'); return; }
  if (!e?.link || !path) return;
  const target = app.fs.run(`readlink -- ${sq(path)}`, app.panel.dir).lines[0] ?? '';
  input(app, label('editSymlink'), mcFormat(mcT("Symlink '%s' points to:"), e.name), target, (v) => exec(app, 'editSymlink', ['ln', '-sfn', '--', v.trim(), path]));
}

function owners(app: McApp, a: McAction): void {
  // absolute paths: they never read as options, and Netfix's chmod takes no --
  const paths = app.panel.selection().map((n) => joinPath(app.panel.dir, n));
  if (!app.fs.exec) { notYet(app, a); return; }
  if (!paths.length) return;
  if (a === 'chmod') { input(app, mcT('Chmod command'), mcT('Permissions (octal):'), '', (v) => exec(app, a, ['chmod', v.trim(), ...paths])); return; }
  if (a === 'chown') { input(app, mcT('Chown command'), mcT('Owner name:'), '', (v) => exec(app, a, ['chown', v.trim(), ...paths])); return; }
  const run = app.fs.exec;
  input(app, mcT('Chown advanced command'), mcT('Permissions (octal) and owner[:group]:'), '', (v) => {
    const [mode, owner] = v.trim().split(/\s+/);
    const err = (mode ? run(['chmod', mode, ...paths]) : null) ?? (owner ? run(['chown', owner, ...paths]) : null);
    app.panel.marked.clear();
    app.fail(err);
  });
}

function listing(app: McApp, p: Panel): void {
  options(app, mcT('Listing format'), [radio('&Full file list', 'f', !p.brief), radio('&Brief file list:', 'f', p.brief)], ([full]) => { p.brief = full !== true; });
}

const SORTS: readonly [SortKey, string][] = [['unsorted', '&Unsorted'], ['name', '&Name'], ['extension', 'E&xtension'], ['mtime', '&Modify time'], ['size', '&Size']];

function sortOrder(app: McApp, p: Panel): void {
  const opts = [...SORTS.map(([k, l]) => radio(l, 's', p.sort === k)), check('&Reverse', p.reverse)];
  options(app, mcT('Sort order'), opts, (on) => {
    p.sort = SORTS[on.findIndex((x, i) => x && i < SORTS.length)]?.[0] ?? 'name';
    p.reverse = on[SORTS.length] === true;
    p.reload(app.fs, p.current()?.name);
  });
}

function filter(app: McApp, p: Panel): void {
  input(app, mcT('Filter'), `${hotLabel(mcT('&Using shell patterns')).text}:`, p.filter ?? '*', (v) => {
    p.filter = v.trim() === '' || v.trim() === '*' ? null : v.trim();
    p.reload(app.fs);
  });
}

/** Left/Right › Info or Quick view: that panel shows the other panel's entry (again: back to the list). */
function aside(app: McApp, side: 0 | 1, mode: 'info' | 'quick'): void {
  const p = app.panels[side];
  p.mode = p.mode === mode ? 'list' : mode;
  if (p.mode !== 'list' && app.active === side) app.active = side === 0 ? 1 : 0;
}

function quickCd(app: McApp): void {
  input(app, mcT('Quick cd'), mcT('cd'), '', (v) => {
    const dir = app.typed(v || '~');
    if (dir === null) return;
    const listed = app.fs.list(dir);
    if (typeof listed === 'string') { app.fail(listed); return; }
    app.panel.go(app.fs, dir);
  });
}

function group(app: McApp, on: boolean): void {
  input(app, mcT(on ? 'Select' : 'Unselect'), `${hotLabel(mcT('&Using shell patterns')).text}:`, '*', (v) => { if (v.trim()) app.panel.markMatching(v.trim(), on, false); });
}

function find(app: McApp): void {
  input(app, mcT('Find File'), mcT('File name:'), '*', (v) => {
    const pattern = v.trim() || '*';
    const line = app.fs.windows ? `dir /s /b "${pattern}"` : `find . -name ${sq(pattern)}`;
    shellView(app, 'find', mcFormat(mcT('Find File: "%s"'), pattern), line);
  });
}

function compareFiles(app: McApp): void {
  const a = app.panel.current();
  const b = app.other.current();
  if (!a || !b || a.dir || b.dir) return;
  const pa = joinPath(app.panel.dir, a.name);
  const pb = joinPath(app.other.dir, b.name);
  const line = app.fs.windows ? `fc "${app.shown(pa)}" "${app.shown(pb)}"` : `diff -u -- ${sq(pa)} ${sq(pb)}`;
  shellView(app, 'compareFiles', `${a.name} ↔ ${b.name}`, line);
}

type Method = 'quick' | 'size' | 'thorough';

/** Whether `name` (a file of p) is missing in q or differs by the chosen method. */
function differs(app: McApp, method: Method, name: string, p: Panel, q: Panel): boolean {
  const a = p.entries.find((e) => e.name === name);
  const b = q.entries.find((e) => e.name === name && !e.dir);
  if (!a || !b) return true;
  if (method === 'size') return a.size !== b.size;
  if (method !== 'thorough') return a.size !== b.size || a.mtime > b.mtime;
  const read = (pn: Panel): string => { const r = app.fs.read(joinPath(pn.dir, name)); return typeof r === 'string' ? r : ''; };
  return read(p) !== read(q);
}

function compareDirs(app: McApp): void {
  const how: readonly [Method, string][] = [['quick', '&Quick'], ['size', '&Size only'], ['thorough', '&Thorough']];
  options(app, mcT('Compare directories'), [heading('Select compare method:'), ...how.map(([, l], i) => radio(l, 'c', i === 0))], (on) => {
    const method = how[on.slice(1).indexOf(true)]?.[0] ?? 'quick';
    for (const [p, q] of [[app.panel, app.other], [app.other, app.panel]] as const) {
      p.marked.clear();
      for (const e of p.entries) if (!e.dir && differs(app, method, e.name, p, q)) p.marked.add(e.name);
    }
  });
}

/** What a folder holds, its files' sizes added up (at most MAX_SIZE_NODES entries visited). */
function dirSize(app: McApp, dir: string): number {
  let total = 0;
  let seen = 0;
  const walk = (d: string): void => {
    const listed = app.fs.list(d);
    if (typeof listed === 'string') return;
    for (const e of listed) {
      if (++seen > MAX_SIZE_NODES) return;
      if (e.dir && !e.link) walk(joinPath(d, e.name));
      else total += e.size;
    }
  };
  walk(dir);
  return total;
}

function dirSizes(app: McApp): void {
  const p = app.panel;
  const marked = p.entries.filter((e) => e.dir && p.marked.has(e.name));
  const cur = p.current();
  const dirs = marked.length ? marked : cur?.dir && cur.name !== '..' ? [cur] : [];
  for (const e of dirs) p.sizes.set(e.name, dirSize(app, joinPath(p.dir, e.name)));
}

function hotlist(app: McApp): void {
  const add = hotLabel(mcT('&Add current')).text;
  app.dialog = {
    kind: 'list', title: mcT('Directory hotlist'), items: [...app.hotlist.map((d) => app.shown(d)), add], cursor: 0,
    onPick: (i) => {
      const dir = app.hotlist[i];
      if (dir !== undefined) app.panel.go(app.fs, dir);
      else if (!app.hotlist.includes(app.panel.dir)) app.hotlist.push(app.panel.dir);
    },
    onDelete: (i) => {
      if (i >= app.hotlist.length || app.dialog?.kind !== 'list') return;
      app.hotlist.splice(i, 1);
      app.dialog.items.splice(i, 1);
    },
  };
}

function histories(app: McApp, files: boolean): void {
  const list = [...(files ? app.fileHistory : app.history)].reverse();
  app.dialog = {
    kind: 'list', title: label(files ? 'fileHistory' : 'history'), items: files ? list.map((x) => app.shown(x)) : list, cursor: 0,
    onPick: (i) => { const x = list[i]; if (x === undefined) return; if (files) app.view(x); else app.line = x; },
  };
}

function config(app: McApp): void {
  const s = app.setup;
  options(app, mcT('Configure options'), [check('Use internal edi&t', s.useInternalEdit), check('A&uto save setup', s.autoSaveSetup)],
    ([edit, autoSave]) => app.changeSetup({ useInternalEdit: edit === true, autoSaveSetup: autoSave === true }));
}

function layout(app: McApp): void {
  const s = app.setup;
  options(app, mcT('Layout'), [heading('Panel split'), radio('&Vertical', 'split', !s.horizontalSplit), radio('&Horizontal', 'split', s.horizontalSplit),
    check('&Menubar visible', s.menubarVisible), check('&Keybar visible', s.keybarVisible), check('Command &prompt', s.commandPrompt)],
  ([, , horizontal, menubar, keybar, prompt]) => app.changeSetup({ horizontalSplit: horizontal === true, menubarVisible: menubar === true, keybarVisible: keybar === true, commandPrompt: prompt === true }));
}

function panelOptions(app: McApp): void {
  const s = app.setup;
  options(app, mcT('Panel options'), [check('Show &hidden files', s.showDotFiles), check('Mi&x all files', s.mixAllFiles), check('Ma&rk moves down', s.markMovesDown), check('Show mi&ni-status', s.showMiniInfo)],
    ([hidden, mix, down, mini]) => app.changeSetup({ showDotFiles: hidden === true, mixAllFiles: mix === true, markMovesDown: down === true, showMiniInfo: mini === true }));
}

function confirmation(app: McApp): void {
  const s = app.setup;
  options(app, mcT('Confirmation'), [check('Confirmation|&Delete', s.confirmDelete), check('Confirmation|E&xit', s.confirmExit)],
    ([del, exit]) => app.changeSetup({ confirmDelete: del === true, confirmExit: exit === true }));
}

function save(app: McApp): void {
  const err = saveSetup(app.fs, app.setup);
  if (err) { app.fail(err); return; }
  app.dirty = false;
  app.dialog = { kind: 'message', title: label('saveSetup'), lines: [mcFormat(mcT('Setup saved to %s'), app.shown(iniPath(app.fs)))], error: false };
}

const FKEY: Partial<Record<McAction, number>> = { view: 3, edit: 4, copy: 5, rename: 6, mkdir: 7, delete: 8, exit: 10 };
const MC_FILES: Partial<Record<McAction, string>> = { editExt: 'mc.ext.ini', editMenu: 'menu', editHighlight: 'filehighlight.ini' };

function panelAction(app: McApp, a: McAction, side: 0 | 1): boolean {
  const p = app.panels[side];
  switch (a) {
    case 'listing': listing(app, p); return true;
    case 'sort': sortOrder(app, p); return true;
    case 'filter': filter(app, p); return true;
    case 'rescan': app.reload(); return true; // both panels: a host rereads mc after changes made elsewhere (Codefix)
    case 'info': aside(app, side, 'info'); return true;
    case 'quickView': aside(app, side, 'quick'); return true;
    case 'tree': app.setTree(side, p.mode !== 'tree'); return true;
    default: return false;
  }
}

function fileAction(app: McApp, a: McAction): boolean {
  switch (a) {
    case 'viewFile': input(app, label('viewFile'), mcT('File name:'), '', (v) => { const path = app.typed(v); if (path) app.view(path); }); return true;
    case 'filtered': input(app, mcT('Filtered view'), mcT('Filter command and arguments:'), '', (v) => {
      const e = app.panel.current();
      if (v.trim() && e) shellView(app, a, v.trim(), `${v.trim()} ${app.fs.windows ? `"${e.name}"` : sq(e.name)}`);
    }); return true;
    case 'chmod': case 'chown': case 'advChown': owners(app, a); return true;
    case 'link': case 'symlink': case 'relSymlink': links(app, a); return true;
    case 'editSymlink': editSymlink(app); return true;
    case 'quickCd': quickCd(app); return true;
    case 'select': group(app, true); return true;
    case 'unselect': group(app, false); return true;
    case 'invert': app.panel.invertMarks(); return true;
    default: return false;
  }
}

function commandAction(app: McApp, a: McAction): boolean {
  switch (a) {
    case 'find': find(app); return true;
    case 'dirTree': app.setTree(app.active, app.panel.mode !== 'tree'); return true;
    case 'swap': app.panels = [app.panels[1], app.panels[0]]; return true;
    case 'panelsOnOff': app.output = app.lastOutput.length ? app.lastOutput : [app.fs.prompt(app.panel.dir)]; return true;
    case 'compareDirs': compareDirs(app); return true;
    case 'compareFiles': compareFiles(app); return true;
    case 'dirSizes': dirSizes(app); return true;
    case 'history': histories(app, false); return true;
    case 'fileHistory': histories(app, true); return true;
    case 'hotlist': hotlist(app); return true;
    default: return false;
  }
}

function optionAction(app: McApp, a: McAction): boolean {
  switch (a) {
    case 'config': config(app); return true;
    case 'layout': layout(app); return true;
    case 'panelOptions': panelOptions(app); return true;
    case 'confirm': confirmation(app); return true;
    case 'saveSetup': save(app); return true;
    // Alt+, changes the layout for this session only: nothing for Auto save setup to write.
    case 'split': app.setup = { ...app.setup, horizontalSplit: !app.setup.horizontalSplit }; return true;
    default: return false;
  }
}

/** Runs a menu item or shortcut; `side` is the panel of the Left/Right menus (else the active one). */
export function runAction(app: McApp, a: McAction, side: 0 | 1): void {
  const key = FKEY[a];
  if (key !== undefined) { app.fkey(key); return; }
  const file = MC_FILES[a];
  if (file !== undefined) { app.edit(joinPath(iniDir(app.fs), file), true); return; }
  if (panelAction(app, a, side) || fileAction(app, a) || commandAction(app, a) || optionAction(app, a)) return;
  notYet(app, a);
}
