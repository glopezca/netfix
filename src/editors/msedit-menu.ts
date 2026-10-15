/**
 * Menus of Microsoft Edit (the Windows terminal's `edit`): the menu bar with the access letter of each menu
 * highlighted (Alt+letter or F10 opens it) and the drop-down list, whose items also show their letter and shortcut.
 */
import type { KeyInput, Span } from './buffer.ts';
import { fit } from './buffer.ts';

export type MenuAction = 'save' | 'exit' | 'undo' | 'redo' | 'find' | 'findNext' | 'goto' | 'top' | 'bottom' | 'keys' | 'about';

interface MenuItem {
  readonly label: string;
  /** Index of the access letter in the label. */
  readonly hot: number;
  readonly shortcut: string;
  readonly action: MenuAction;
}

interface Menu {
  readonly title: string;
  readonly items: readonly MenuItem[];
}

export interface MenuState {
  readonly menu: number;
  readonly item: number;
}

const item = (label: string, letter: string, shortcut: string, action: MenuAction): MenuItem => ({ label, hot: label.indexOf(letter), shortcut, action });

export const MENUS: readonly Menu[] = [
  { title: 'File', items: [item('Save', 'S', 'Ctrl+S', 'save'), item('Exit', 'x', 'Ctrl+Q', 'exit')] },
  { title: 'Edit', items: [item('Undo', 'U', 'Ctrl+Z', 'undo'), item('Redo', 'R', 'Ctrl+Y', 'redo'), item('Find...', 'F', 'Ctrl+F', 'find'), item('Find next', 'n', 'F3', 'findNext')] },
  { title: 'View', items: [item('Go to line...', 'G', 'Ctrl+G', 'goto'), item('Top of file', 'T', 'Ctrl+Home', 'top'), item('End of file', 'E', 'Ctrl+End', 'bottom')] },
  { title: 'Help', items: [item('Keyboard shortcuts', 'K', '', 'keys'), item('About', 'A', '', 'about')] },
];

/** The menu whose title starts with `letter` (Alt+F, Alt+E…), or -1. */
export function menuByLetter(letter: string): number {
  return MENUS.findIndex((m) => m.title[0]?.toLowerCase() === letter.toLowerCase());
}

/** Column of each menu title in the bar (" File  Edit  View  Help"). */
function titleColumns(): number[] {
  let col = 1;
  return MENUS.map((m) => {
    const at = col;
    col += m.title.length + 2;
    return at;
  });
}

/** A label with its access letter highlighted. */
function hotSpans(label: string, hot: number, selected: boolean): Span[] {
  const base = selected ? 'menuSel' : 'inverse';
  return [
    { text: label.slice(0, hot), style: base },
    { text: label.slice(hot, hot + 1), style: selected ? 'hotkeySel' : 'hotkey' },
    { text: label.slice(hot + 1), style: base },
  ];
}

export function menuBar(width: number, right: string, open: MenuState | null): Span[] {
  const spans: Span[] = [{ text: ' ', style: 'inverse' }];
  MENUS.forEach((m, i) => {
    const sel = open?.menu === i;
    spans.push(...hotSpans(m.title, 0, sel), { text: '  ', style: 'inverse' });
  });
  const used = spans.reduce((n, s) => n + s.text.length, 0);
  spans.push({ text: fit(`${' '.repeat(Math.max(1, width - used - right.length))}${right}`, Math.max(0, width - used)), style: 'inverse' });
  return clip(spans, width);
}

/** The drop-down list drawn over the text rows (rows[0] is the first text row, under the bar). */
export function overlayMenu(rows: readonly Span[][], st: MenuState, width: number): Span[][] {
  const m = MENUS[st.menu];
  if (!m) return [...rows];
  const left = Math.min(titleColumns()[st.menu] ?? 1, Math.max(0, width - 2));
  const inner = Math.max(...m.items.map((it) => it.label.length + (it.shortcut ? it.shortcut.length + 4 : 0)));
  const boxWidth = Math.min(inner + 2, width - left);
  return rows.map((row, r) => {
    const it = m.items[r];
    if (!it) return [...row];
    const text = row.map((s) => s.text).join('');
    const sel = r === st.item;
    const gap = Math.max(1, boxWidth - 2 - it.label.length - it.shortcut.length);
    const style = sel ? 'menuSel' : 'inverse';
    return clip([
      { text: text.slice(0, left) },
      { text: ' ', style }, ...hotSpans(it.label, it.hot, sel), { text: `${' '.repeat(gap)}${it.shortcut} `.slice(0, Math.max(0, boxWidth - 1 - it.label.length)), style },
      { text: text.slice(left + boxWidth) },
    ], width);
  });
}

/** Spans cut to the screen width (a narrow screen cuts the menu box, never widens the row). */
function clip(spans: readonly Span[], width: number): Span[] {
  const out: Span[] = [];
  let used = 0;
  for (const s of spans) {
    const text = s.text.slice(0, Math.max(0, width - used));
    if (text) out.push({ ...s, text });
    used += text.length;
  }
  return out;
}

/** A key while a menu is open: moves, switches menu, runs an item (Enter or its letter) or closes (Esc). */
export function menuKey(st: MenuState, k: KeyInput): { readonly state: MenuState | null; readonly action?: MenuAction } {
  const m = MENUS[st.menu];
  if (!m || k.key === 'Escape' || k.key === 'F10' || (k.ctrl && k.key.toLowerCase() === 'c')) return { state: null };
  const n = MENUS.length;
  switch (k.key) {
    case 'ArrowLeft': return { state: { menu: (st.menu + n - 1) % n, item: 0 } };
    case 'ArrowRight': return { state: { menu: (st.menu + 1) % n, item: 0 } };
    case 'ArrowUp': return { state: { ...st, item: (st.item + m.items.length - 1) % m.items.length } };
    case 'ArrowDown': return { state: { ...st, item: (st.item + 1) % m.items.length } };
    case 'Enter': return { state: null, action: m.items[st.item]?.action };
    default: break;
  }
  if (k.alt && menuByLetter(k.key) >= 0) return { state: { menu: menuByLetter(k.key), item: 0 } };
  const hit = m.items.find((it) => it.label[it.hot]?.toLowerCase() === k.key.toLowerCase());
  return hit ? { state: null, action: hit.action } : { state: st };
}
