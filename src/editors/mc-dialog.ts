/** Midnight Commander dialogs: an input line (copy, move, mkdir), a yes/no question or a message. */
import type { KeyInput, Span } from './buffer.ts';
import { fit } from './buffer.ts';

export type Dialog =
  | { readonly kind: 'input'; readonly title: string; readonly label: string; value: string; readonly onOk: (value: string) => void }
  | { readonly kind: 'confirm'; readonly title: string; readonly text: string; yes: boolean; readonly onYes: () => void }
  | { readonly kind: 'message'; readonly title: string; readonly lines: readonly string[]; readonly error: boolean };

/** Handles a key; returns true when the dialog is finished (closed). */
export function dialogKey(d: Dialog, k: KeyInput): boolean {
  if (k.key === 'Escape' || (k.ctrl && k.key.toLowerCase() === 'c') || k.key === 'F10') return true;
  if (d.kind === 'message') return k.key === 'Enter' || k.key === ' ';
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

/** Draws the dialog centred over `rows` (a screen `width` wide); returns the cursor cell. */
export function drawDialog(d: Dialog, rows: Span[][], width: number): { row: number; col: number } | null {
  const w = Math.min(width - 4, 60);
  const body: { text: string; style: Span['style'] }[] = [];
  if (d.kind === 'input') body.push({ text: d.label, style: 'dialog' }, { text: d.value, style: 'dialogFocus' }, { text: '', style: 'dialog' }, { text: '[< OK >]  [ Cancel ]', style: 'dialog' });
  else if (d.kind === 'confirm') body.push(...wrap(d.text, w - 4).map((text) => ({ text, style: 'dialog' as const })), { text: '', style: 'dialog' }, { text: d.yes ? '[< Yes >]   [ No ]' : '[ Yes ]   [< No >]', style: 'dialog' });
  else body.push(...d.lines.flatMap((l) => wrap(l, w - 4)).map((text) => ({ text, style: (d.error ? 'error' : 'dialog') as Span['style'] })), { text: '', style: 'dialog' }, { text: '[< OK >]', style: 'dialog' });
  const top = Math.max(1, Math.floor((rows.length - body.length - 2) / 2));
  const left = Math.max(0, Math.floor((width - w) / 2));
  const title = ` ${d.title} `;
  const put = (r: number, spans: Span[]): void => {
    const row = rows[r];
    if (row) rows[r] = [...sliceSpans(row, 0, left), ...spans, ...sliceSpans(row, left + w, Number.MAX_SAFE_INTEGER)];
  };
  const pad = Math.max(0, Math.floor((w - 2 - title.length) / 2));
  put(top, [{ text: `┌${'─'.repeat(pad)}${title}${'─'.repeat(Math.max(0, w - 2 - pad - title.length))}┐`, style: d.kind === 'message' && d.error ? 'error' : 'dialog' }]);
  body.forEach((b, i) => put(top + 1 + i, [{ text: '│ ', style: 'dialog' }, { text: fit(b.text, w - 4), style: b.style }, { text: ' │', style: 'dialog' }]));
  put(top + 1 + body.length, [{ text: `└${'─'.repeat(w - 2)}┘`, style: 'dialog' }]);
  return d.kind === 'input' ? { row: top + 2, col: left + 2 + Math.min(d.value.length, w - 5) } : null;
}
