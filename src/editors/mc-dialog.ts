/**
 * Midnight Commander dialogs: an input line (copy, move, mkdir…), a yes/no question, a message, a box of checkboxes and
 * radio buttons (Options › Layout, Sort order…) and a list to pick from (history, hotlist). Buttons in mc's words.
 */
import type { KeyInput, Span } from './buffer.ts';
import { fit } from './buffer.ts';
import { hotLabel, mcQ, mcT } from './mc-i18n.ts';

/** A line of an options box: a checkbox, a radio button of `group`, or a heading (`group` and `on` unused). */
export interface McOption {
  /** mc's msgid, with & before its hotkey. */
  readonly label: string;
  readonly kind: 'check' | 'radio' | 'heading';
  readonly group?: string;
  on: boolean;
}

export type Dialog =
  | { readonly kind: 'input'; readonly title: string; readonly label: string; value: string; readonly onOk: (value: string) => void }
  | { readonly kind: 'confirm'; readonly title: string; readonly text: string; yes: boolean; readonly onYes: () => void }
  | { readonly kind: 'message'; readonly title: string; readonly lines: readonly string[]; readonly error: boolean }
  | { readonly kind: 'options'; readonly title: string; readonly options: McOption[]; cursor: number; readonly onOk: (on: readonly boolean[]) => void }
  | { readonly kind: 'list'; readonly title: string; items: string[]; cursor: number; readonly onPick: (index: number) => void; readonly onDelete?: (index: number) => void };

type Options = Extract<Dialog, { kind: 'options' }>;
type List = Extract<Dialog, { kind: 'list' }>;

const pickable = (o: McOption | undefined): boolean => o !== undefined && o.kind !== 'heading';

function toggle(d: Options, i: number): void {
  const o = d.options[i];
  if (!o || !pickable(o)) return;
  if (o.kind === 'check') { o.on = !o.on; return; }
  for (const x of d.options) if (x.kind === 'radio' && x.group === o.group) x.on = x === o;
}

function optionsKey(d: Options, k: KeyInput): boolean {
  const n = d.options.length;
  const move = (by: number): void => {
    let i = d.cursor;
    do i = (i + by + n) % n; while (!pickable(d.options[i]));
    d.cursor = i;
  };
  if (k.key === 'ArrowDown' || k.key === 'Tab') move(1);
  else if (k.key === 'ArrowUp') move(-1);
  else if (k.key === ' ') toggle(d, d.cursor);
  else if (k.key === 'Enter') { d.onOk(d.options.map((o) => o.on)); return true; }
  else {
    const hit = d.options.findIndex((o) => { const h = hotLabel(mcQ(o.label)); return pickable(o) && h.hot >= 0 && h.text[h.hot]?.toLowerCase() === k.key.toLowerCase(); });
    if (hit >= 0) { d.cursor = hit; toggle(d, hit); }
  }
  return false;
}

function listKey(d: List, k: KeyInput): boolean {
  const n = d.items.length;
  if (k.key === 'ArrowDown') d.cursor = Math.min(n - 1, d.cursor + 1);
  else if (k.key === 'ArrowUp') d.cursor = Math.max(0, d.cursor - 1);
  else if (k.key === 'Home') d.cursor = 0;
  else if (k.key === 'End') d.cursor = Math.max(0, n - 1);
  else if (k.key === 'Delete' && d.onDelete && n > 0) { d.onDelete(d.cursor); d.cursor = Math.max(0, Math.min(d.cursor, d.items.length - 1)); }
  else if (k.key === 'Enter') { if (n > 0) d.onPick(d.cursor); return true; }
  return false;
}

/** Handles a key; returns true when the dialog is finished (closed). */
export function dialogKey(d: Dialog, k: KeyInput): boolean {
  if (k.key === 'Escape' || (k.ctrl && k.key.toLowerCase() === 'c') || k.key === 'F10') return true;
  if (d.kind === 'message') return k.key === 'Enter' || k.key === ' ';
  if (d.kind === 'options') return optionsKey(d, k);
  if (d.kind === 'list') return listKey(d, k);
  if (d.kind === 'confirm') {
    if (['ArrowLeft', 'ArrowRight', 'Tab'].includes(k.key)) { d.yes = !d.yes; return false; }
    const c = k.key.toLowerCase();
    if (c === 'y' || c === 's' || (k.key === 'Enter' && d.yes)) { d.onYes(); return true; }
    return c === 'n' || k.key === 'Enter';
  }
  if (k.key === 'Enter') { d.onOk(d.value); return true; }
  if (k.key === 'Backspace') d.value = d.value.slice(0, -1);
  else if (k.ctrl && k.key.toLowerCase() === 'u') d.value = '';
  else if (k.key.length === 1 && !k.ctrl && !k.alt) d.value += k.key;
  return false;
}

/** Splits a message into lines of at most `width` characters (at spaces when possible). */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width);
    const at = cut > width / 3 ? cut : width;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

/** The part of a row of spans between two columns, keeping each span's style. */
export function sliceSpans(row: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let col = 0;
  for (const s of row) {
    const a = Math.max(from, col);
    const b = Math.min(to, col + s.text.length);
    if (b > a) out.push({ text: s.text.slice(a - col, b - col), style: s.style });
    col += s.text.length;
  }
  return out;
}

const button = (msgid: string, focus: boolean): string => {
  const text = hotLabel(mcT(msgid)).text;
  return focus ? `[< ${text} >]` : `[ ${text} ]`;
};

interface Line { readonly text: string; readonly style: Span['style'] }

const LIST_ROWS = 12;
const plain = (text: string, style: Span['style'] = 'dialog'): Line => ({ text, style });

function optionLine(o: McOption, focus: boolean): Line {
  const text = hotLabel(mcQ(o.label)).text;
  if (o.kind === 'heading') return plain(text);
  const mark = o.kind === 'check' ? (o.on ? '[x] ' : '[ ] ') : (o.on ? '(*) ' : '( ) ');
  return plain(`${mark}${text}`, focus ? 'dialogFocus' : 'dialog');
}

function body(d: Dialog, w: number): Line[] {
  const okCancel = plain(`${button('&OK', true)}  ${button('&Cancel', false)}`);
  switch (d.kind) {
    case 'input': return [plain(d.label), plain(d.value, 'dialogFocus'), plain(''), okCancel];
    case 'confirm': return [...wrap(d.text, w - 4).map((t) => plain(t)), plain(''), plain(`${button('&Yes', d.yes)}   ${button('&No', !d.yes)}`)];
    case 'message': return [...d.lines.flatMap((l) => wrap(l, w - 4)).map((t) => plain(t, d.error ? 'error' : 'dialog')), plain(''), plain(button('&OK', true))];
    case 'options': return [...d.options.map((o, i) => optionLine(o, i === d.cursor)), plain(''), okCancel];
    case 'list': {
      const top = Math.max(0, Math.min(d.cursor - LIST_ROWS + 1, d.items.length - LIST_ROWS));
      const shown = d.items.slice(top, top + LIST_ROWS).map((t, i) => plain(t, top + i === d.cursor ? 'dialogFocus' : 'dialog'));
      return [...(shown.length ? shown : [plain('')]), plain(''), okCancel];
    }
  }
}

/** Draws the dialog centred over `rows` (a screen `width` wide); returns the cursor cell. */
export function drawDialog(d: Dialog, rows: Span[][], width: number): { row: number; col: number } | null {
  const w = Math.min(width - 4, 60);
  const lines = body(d, w);
  const top = Math.max(1, Math.floor((rows.length - lines.length - 2) / 2));
  const left = Math.max(0, Math.floor((width - w) / 2));
  const title = ` ${d.title} `;
  const put = (r: number, spans: Span[]): void => {
    const row = rows[r];
    if (row) rows[r] = [...sliceSpans(row, 0, left), ...spans, ...sliceSpans(row, left + w, Number.MAX_SAFE_INTEGER)];
  };
  const pad = Math.max(0, Math.floor((w - 2 - title.length) / 2));
  put(top, [{ text: `┌${'─'.repeat(pad)}${title}${'─'.repeat(Math.max(0, w - 2 - pad - title.length))}┐`, style: d.kind === 'message' && d.error ? 'error' : 'dialog' }]);
  lines.forEach((b, i) => put(top + 1 + i, [{ text: '│ ', style: 'dialog' }, { text: fit(b.text, w - 4), style: b.style }, { text: ' │', style: 'dialog' }]));
  put(top + 1 + lines.length, [{ text: `└${'─'.repeat(w - 2)}┘`, style: 'dialog' }]);
  return d.kind === 'input' ? { row: top + 2, col: left + 2 + Math.min(d.value.length, w - 5) } : null;
}
