/**
 * Midnight Commander 4.8's menu bar (F9): Left, File, Command, Options and Right, with every item, hotkey and shortcut
 * of the real one, in mc's own words (mc-i18n.ts). Netfix carries out what an item does (mc-commands.ts).
 */
import type { KeyInput, Span } from './buffer.ts';
import { fit } from './buffer.ts';
import { sliceSpans } from './mc-dialog.ts';
import { hotLabel, mcT } from './mc-i18n.ts';

export type McAction =
  | 'listing' | 'quickView' | 'info' | 'tree' | 'panelize' | 'sort' | 'filter' | 'encoding' | 'ftp' | 'shellLink' | 'sftp' | 'rescan'
  | 'view' | 'viewFile' | 'filtered' | 'edit' | 'copy' | 'chmod' | 'link' | 'symlink' | 'relSymlink' | 'editSymlink' | 'chown'
  | 'advChown' | 'rename' | 'mkdir' | 'delete' | 'quickCd' | 'select' | 'unselect' | 'invert' | 'exit'
  | 'userMenu' | 'dirTree' | 'find' | 'swap' | 'panelsOnOff' | 'compareDirs' | 'compareFiles' | 'extPanelize' | 'dirSizes'
  | 'history' | 'fileHistory' | 'hotlist' | 'vfsList' | 'jobs' | 'screens' | 'editExt' | 'editMenu' | 'editHighlight'
  | 'config' | 'layout' | 'panelOptions' | 'confirm' | 'appearance' | 'displayBits' | 'learnKeys' | 'vfs' | 'saveSetup'
  /** Alt+, (no menu item): the panel split, as Options › Layout sets it. */
  | 'split';

export interface McItem {
  /** mc's msgid, with & before the hotkey. */
  readonly label: string;
  readonly keys: string;
  readonly action: McAction;
}

interface McMenu {
  readonly title: string;
  /** null: a separator line. */
  readonly items: readonly (McItem | null)[];
}

const it = (label: string, keys: string, action: McAction): McItem => ({ label, keys, action });

const PANEL_ITEMS: readonly (McItem | null)[] = [
  it('&Listing format...', '', 'listing'), it('&Quick view', 'C-x q', 'quickView'), it('&Info', 'C-x i', 'info'),
  it('&Tree', '', 'tree'), it('Paneli&ze', '', 'panelize'), null,
  it('&Sort order...', '', 'sort'), it('&Filter...', '', 'filter'), it('&Encoding...', 'M-e', 'encoding'), null,
  it('FT&P link...', '', 'ftp'), it('S&hell link...', '', 'shellLink'), it('SFTP li&nk...', '', 'sftp'), null,
  it('&Rescan', 'C-r', 'rescan'),
];

export const MC_MENUS: readonly McMenu[] = [
  { title: '&Left', items: PANEL_ITEMS },
  { title: '&File', items: [
    it('&View', 'F3', 'view'), it('Vie&w file...', '', 'viewFile'), it('&Filtered view', 'M-!', 'filtered'), it('&Edit', 'F4', 'edit'),
    it('&Copy', 'F5', 'copy'), it('C&hmod', 'C-x c', 'chmod'), it('&Link', 'C-x l', 'link'), it('&Symlink', 'C-x s', 'symlink'),
    it('Relative symlin&k', 'C-x v', 'relSymlink'), it('Edit s&ymlink', 'C-x C-s', 'editSymlink'), it('Ch&own', 'C-x o', 'chown'),
    it('&Advanced chown', '', 'advChown'), it('&Rename/Move', 'F6', 'rename'), it('&Mkdir', 'F7', 'mkdir'), it('&Delete', 'F8', 'delete'),
    it('&Quick cd', 'M-c', 'quickCd'), null,
    it('Select &group', '+', 'select'), it('U&nselect group', '\\', 'unselect'), it('&Invert selection', '*', 'invert'), null,
    it('E&xit', 'F10', 'exit'),
  ] },
  { title: '&Command', items: [
    it('&User menu', 'F2', 'userMenu'), it('&Directory tree', '', 'dirTree'), it('&Find file', 'M-?', 'find'), it('S&wap panels', 'C-u', 'swap'),
    it('Switch &panels on/off', 'C-o', 'panelsOnOff'), it('&Compare directories', 'C-x d', 'compareDirs'),
    it('C&ompare files', 'C-x C-d', 'compareFiles'), it('E&xternal panelize', 'C-x !', 'extPanelize'),
    it('Show directory s&izes', 'C-Space', 'dirSizes'), null,
    it('Command &history', 'M-h', 'history'), it('Viewed/edited files hi&story', 'M-E', 'fileHistory'),
    it('Di&rectory hotlist', 'C-\\', 'hotlist'), it('&Active VFS list', 'C-x a', 'vfsList'), it('&Background jobs', 'C-x j', 'jobs'),
    it('Screen lis&t', 'M-`', 'screens'), null,
    it('Edit &extension file', '', 'editExt'), it('Edit &menu file', '', 'editMenu'), it('Edit hi&ghlighting group file', '', 'editHighlight'),
  ] },
  { title: '&Options', items: [
    it('&Configuration...', '', 'config'), it('&Layout...', '', 'layout'), it('Panel spli&t', 'M-,', 'split'), it('&Panel options...', '', 'panelOptions'),
    it('C&onfirmation...', '', 'confirm'), it('&Appearance...', '', 'appearance'), it('&Display bits...', '', 'displayBits'),
    it('Learn &keys...', '', 'learnKeys'), it('&Virtual FS...', '', 'vfs'), null, it('&Save setup', '', 'saveSetup'),
  ] },
  { title: '&Right', items: PANEL_ITEMS },
];

export interface MenuState {
  readonly menu: number;
  readonly item: number;
}

const GAP = 5;

/** A menu's title: with the panels one over the other, Left and Right are mc's Above and Below. */
export function menuTitle(i: number, horizontal: boolean): string {
  if (horizontal && i === 0) return '&Above';
  if (horizontal && i === MC_MENUS.length - 1) return '&Below';
  return MC_MENUS[i]?.title ?? '';
}

/** The space between titles: up to five, fewer on a narrow screen so all five titles fit (at least one). */
function gap(width: number, horizontal: boolean): number {
  const titles = MC_MENUS.reduce((n, _, i) => n + hotLabel(mcT(menuTitle(i, horizontal))).text.length, 0);
  return Math.max(1, Math.min(GAP, Math.floor((width - 2 - titles) / (MC_MENUS.length - 1))));
}

/** Column of each title in the bar ("  Left     File     Command…"). */
function columns(width: number, horizontal: boolean): number[] {
  let col = 2;
  const g = gap(width, horizontal);
  return MC_MENUS.map((_, i) => {
    const at = col;
    col += hotLabel(mcT(menuTitle(i, horizontal))).text.length + g;
    return at;
  });
}

function hotSpans(label: string, selected: boolean, base: Span['style']): Span[] {
  const { text, hot } = hotLabel(mcT(label));
  const style = selected ? 'menuSel' : base;
  if (hot < 0) return [{ text, style }];
  return [{ text: text.slice(0, hot), style }, { text: text.slice(hot, hot + 1), style: selected ? 'hotkeySel' : 'hotkey' }, { text: text.slice(hot + 1), style }];
}

/** The bar (row 0), its open menu highlighted. */
export function menuBar(width: number, open: MenuState | null, horizontal = false): Span[] {
  const spans: Span[] = [{ text: '  ', style: 'menu' }];
  const g = gap(width, horizontal);
  MC_MENUS.forEach((_, i) => spans.push(...hotSpans(menuTitle(i, horizontal), open?.menu === i, 'menu'), { text: ' '.repeat(g), style: 'menu' }));
  const used = spans.reduce((n, s) => n + s.text.length, 0);
  return sliceSpans([...spans, { text: fit('', Math.max(0, width - used)), style: 'menu' }], 0, width);
}

/** The open menu's box over the screen rows (row 0 is the bar). */
export function drawMenu(rows: Span[][], st: MenuState, width: number, horizontal = false): void {
  const m = MC_MENUS[st.menu];
  if (!m) return;
  const labels = m.items.map((x) => (x ? hotLabel(mcT(x.label)).text.length + (x.keys ? x.keys.length + 3 : 0) : 0));
  const inner = Math.min(width - 2, Math.max(...labels) + 2);
  const left = Math.max(0, Math.min(columns(width, horizontal)[st.menu] ?? 0, width - inner - 2));
  const put = (r: number, spans: Span[]): void => {
    const row = rows[r];
    if (row) rows[r] = [...sliceSpans(row, 0, left), ...sliceSpans(spans, 0, inner + 2), ...sliceSpans(row, left + inner + 2, Number.MAX_SAFE_INTEGER)];
  };
  put(1, [{ text: `┌${'─'.repeat(inner)}┐`, style: 'dialog' }]);
  m.items.forEach((x, i) => {
    if (!x) { put(2 + i, [{ text: `├${'─'.repeat(inner)}┤`, style: 'dialog' }]); return; }
    const sel = i === st.item;
    const label = hotSpans(x.label, sel, 'dialog');
    const len = label.reduce((n, s) => n + s.text.length, 0);
    const gap = Math.max(1, inner - 2 - len - x.keys.length);
    put(2 + i, [{ text: '│', style: 'dialog' }, { text: ' ', style: sel ? 'menuSel' : 'dialog' }, ...label, { text: `${' '.repeat(gap)}${x.keys} `, style: sel ? 'menuSel' : 'dialog' }, { text: '│', style: 'dialog' }]);
  });
  put(2 + m.items.length, [{ text: `└${'─'.repeat(inner)}┘`, style: 'dialog' }]);
}

/** The next item that is not a separator, going `by` (±1) from `from`. */
function step(m: McMenu, from: number, by: number): number {
  const n = m.items.length;
  let i = from;
  do i = (i + by + n) % n; while (!m.items[i]);
  return i;
}

const first = (menu: number): MenuState => ({ menu, item: 0 });

const hotOf = (label: string): string => {
  const h = hotLabel(mcT(label));
  return (h.text[h.hot] ?? '').toLowerCase();
};

/** A key while the menu is open: moves, switches menu, runs an item (Enter or its hotkey) or closes it. */
export function menuKey(st: MenuState, k: KeyInput, horizontal = false): { readonly state: MenuState | null; readonly item?: McItem } {
  const m = MC_MENUS[st.menu];
  if (!m || ['Escape', 'F9', 'F10'].includes(k.key) || (k.ctrl && ['c', 'g'].includes(k.key.toLowerCase()))) return { state: null };
  const n = MC_MENUS.length;
  switch (k.key) {
    case 'ArrowLeft': return { state: first((st.menu + n - 1) % n) };
    case 'ArrowRight': return { state: first((st.menu + 1) % n) };
    case 'ArrowUp': return { state: { ...st, item: step(m, st.item, -1) } };
    case 'ArrowDown': return { state: { ...st, item: step(m, st.item, 1) } };
    case 'Home': return { state: first(st.menu) };
    case 'End': return { state: { ...st, item: step(m, 0, -1) } };
    case 'Enter': return { state: null, item: m.items[st.item] ?? undefined };
    default: break;
  }
  const c = k.key.toLowerCase();
  const hit = m.items.find((x) => x !== null && hotOf(x.label) === c);
  if (hit) return { state: null, item: hit };
  const menu = MC_MENUS.findIndex((_, i) => hotOf(menuTitle(i, horizontal)) === c);
  return { state: menu >= 0 ? first(menu) : st };
}
