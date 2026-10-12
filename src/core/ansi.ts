/** ANSI escape sequences in terminal text: SGR colours/attributes as styled runs, and the clear-screen request. */

export interface AnsiStyle {
  /** 0-15 (8-15 bright) or 16-255 (xterm palette). */
  readonly fg?: number;
  readonly bg?: number;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
}

export interface AnsiRun extends AnsiStyle {
  readonly text: string;
}

const ESC_SEQ = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b[()][0-9A-B]|\x1b[=>]|[\x01\x02]/g;
const CLEAR = /\x1b\[[0-9;]*J/;
const BRIGHT = 8;

function extended(codes: number[], i: number): { color?: number; skip: number } {
  if (codes[i + 1] === 5) return { color: codes[i + 2], skip: 2 };
  if (codes[i + 1] === 2) return { skip: 4 };
  return { skip: 0 };
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(';').map((n) => Number(n) || 0);
  let s: { -readonly [K in keyof AnsiStyle]: AnsiStyle[K] } = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] ?? 0;
    if (c === 0) s = {};
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 22) { s.bold = false; s.dim = false; }
    else if (c === 23) s.italic = false;
    else if (c === 24) s.underline = false;
    else if (c === 27) s.inverse = false;
    else if (c >= 30 && c <= 37) s.fg = c - 30;
    else if (c >= 90 && c <= 97) s.fg = c - 90 + BRIGHT;
    else if (c === 39) s.fg = undefined;
    else if (c >= 40 && c <= 47) s.bg = c - 40;
    else if (c >= 100 && c <= 107) s.bg = c - 100 + BRIGHT;
    else if (c === 49) s.bg = undefined;
    else if (c === 38 || c === 48) {
      const e = extended(codes, i);
      if (c === 38) s.fg = e.color; else s.bg = e.color;
      i += e.skip;
    }
  }
  return s;
}

/** Splits text into styled runs; `style` is the state carried over from the previous line. */
export function parseAnsi(text: string, style: AnsiStyle = {}): { runs: AnsiRun[]; style: AnsiStyle } {
  const runs: AnsiRun[] = [];
  let cur = style;
  let last = 0;
  for (const m of text.matchAll(ESC_SEQ)) {
    const idx = m.index ?? 0;
    if (idx > last) runs.push({ ...cur, text: text.slice(last, idx) });
    if (m[2] === 'm') cur = applySgr(cur, m[1] ?? '');
    last = idx + m[0].length;
  }
  if (last < text.length) runs.push({ ...cur, text: text.slice(last) });
  return { runs, style: cur };
}

/** True when the text asks to clear the screen (`clear`, Ctrl+L); `after` is what follows the last request. */
export function clearRequest(text: string): { clear: boolean; after: string } {
  if (!CLEAR.test(text)) return { clear: false, after: text };
  const parts = text.split(/\x1b\[[0-9;]*J/);
  return { clear: true, after: (parts[parts.length - 1] ?? '').replace(/^(\x1b\[[0-9;]*[HJ])+/, '') };
}

export function stripAnsi(text: string): string {
  return text.replace(ESC_SEQ, '');
}
