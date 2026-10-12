/** Screen layout of GNU nano 8: title bar, text area, status line and the two shortcut rows. */
import type { Frame, Span } from './buffer.ts';
import { displayCol, expandTabs, fit } from './buffer.ts';

export const NANO_VERSION = '8.4';

const MIN_CELL = 13;

export type Shortcut = readonly [key: string, label: string];

export const MAIN_KEYS: readonly Shortcut[] = [
  ['^G', 'Help'], ['^X', 'Exit'], ['^O', 'Write Out'], ['^R', 'Read File'], ['^F', 'Where Is'], ['^\\', 'Replace'],
  ['^K', 'Cut'], ['^U', 'Paste'], ['^T', 'Execute'], ['^J', 'Justify'], ['^C', 'Location'], ['^/', 'Go To Line'],
  ['M-U', 'Undo'], ['M-E', 'Redo'], ['M-A', 'Set Mark'], ['M-6', 'Copy'],
];
export const PROMPT_KEYS: readonly Shortcut[] = [['^G', 'Help'], ['^C', 'Cancel'], ['^Y', 'First Line'], ['^V', 'Last Line']];
export const WRITE_KEYS: readonly Shortcut[] = [['^G', 'Help'], ['^C', 'Cancel'], ['M-D', 'DOS Format'], ['M-M', 'Mac Format'], ['M-A', 'Append'], ['M-P', 'Prepend']];
export const YES_NO_KEYS: readonly Shortcut[] = [[' Y', 'Yes'], [' N', 'No'], ['', ''], ['^C', 'Cancel']];
export const REPLACE_KEYS: readonly Shortcut[] = [[' Y', 'Yes'], [' N', 'No'], [' A', 'All'], ['^C', 'Cancel']];
export const HELP_KEYS: readonly Shortcut[] = [['^L', 'Refresh'], ['^X', 'Close'], ['^Y', 'Prev Page'], ['^V', 'Next Page']];

export const HELP_TEXT = [
  'Main nano help text',
  '',
  ' The nano editor is designed to emulate the functionality and ease-of-use of',
  ' the UW Pico text editor.  There are four main sections of the editor.  The',
  ' top line shows the program version, the current filename being edited, and',
  ' whether or not the file has been modified.  Next is the main editor window',
  ' showing the file being edited.  The status line is the third line from the',
  ' bottom and shows important messages.  The bottom two lines show the most',
  ' commonly used shortcuts in the editor.',
  '',
  ' Shortcuts are written as follows: Control-key sequences are notated with a',
  " '^' and can be entered either by using the Ctrl key or pressing the Esc key",
  " twice.  Meta-key sequences are notated with 'M-' and can be entered using",
  ' either the Alt, Cmd, or Esc key, depending on your keyboard setup.',
  '',
  '^G  F1      Display this help text',
  '^X  F2      Close the current buffer / Exit from nano',
  '^O  F3      Write the current buffer (or the marked region) to disk',
  '^S          Save file without prompting',
  '^F  ^W      Start a forward search',
  'M-W F16     Search next occurrence forward',
  '^\\  M-R     Replace a string',
  '^K  F9      Cut current line into cutbuffer',
  '^U  F10     Paste the contents of cutbuffer at current cursor position',
  '^C  F11     Display the position of the cursor',
  '^/  ^_      Go to line and column number',
  'M-U         Undo the last operation',
  'M-E         Redo the last undone operation',
  '^A  Home    Go to beginning of current line',
  '^E  End     Go to end of current line',
  '^Y  PgUp    Go one screenful up',
  '^V  PgDn    Go one screenful down',
  'M-\\  ^Home  Go to the first line of the file',
  'M-/  ^End   Go to the last line of the file',
];

/** Two rows of shortcuts, each cell as wide as the screen allows. */
export function shortcutRows(keys: readonly Shortcut[], width: number): Span[][] {
  const perRow = Math.max(1, Math.min(Math.ceil(keys.length / 2), Math.floor(width / MIN_CELL)));
  const cell = Math.floor(width / perRow);
  const rows: Span[][] = [[], []];
  keys.forEach(([k, label], i) => {
    const row = rows[i % 2] as Span[];
    if (row.reduce((n, s) => n + s.text.length, 0) + cell > width) return;
    row.push({ text: k, style: 'inverse' }, { text: fit(` ${label}`.slice(0, Math.max(0, cell - k.length - 1)), cell - k.length) });
  });
  return rows;
}

export function titleBar(name: string, modified: boolean, width: number): Span[] {
  const left = `  GNU nano ${NANO_VERSION}`;
  const right = modified ? 'Modified  ' : '';
  const mid = Math.max(left.length + 1, Math.floor((width - name.length) / 2));
  const text = fit(`${left.padEnd(mid)}${name}`, width - right.length) + right;
  return [{ text: fit(text, width), style: 'inverse' }];
}

/** Status line: a centred [ message ] or an inverse prompt with its answer. */
export function statusRow(message: string | null, prompt: string | null, width: number): Span[] {
  if (prompt !== null) return [{ text: fit(prompt, width), style: 'inverse' }];
  if (!message) return [{ text: ' '.repeat(width) }];
  const text = `[ ${message} ]`;
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return [{ text: ' '.repeat(pad) }, { text, style: 'inverse' }, { text: ' '.repeat(Math.max(0, width - pad - text.length)) }];
}

export interface TextView {
  readonly lines: readonly string[];
  readonly top: number;
  readonly row: number;
  readonly col: number;
}

/** Text rows (the cursor line scrolls horizontally when it does not fit) and the cursor cell. */
export function textArea(v: TextView, width: number, height: number, firstRow: number): { rows: Span[][]; cursor: Frame['cursor'] } {
  const rows: Span[][] = [];
  let cursor: Frame['cursor'] = null;
  for (let i = 0; i < height; i++) {
    const r = v.top + i;
    const line = v.lines[r];
    if (line === undefined) { rows.push([{ text: ' '.repeat(width) }]); continue; }
    const shown = expandTabs(line);
    let offset = 0;
    if (r === v.row) {
      const dc = displayCol(line, v.col);
      const span = Math.max(1, width - 1);
      offset = dc >= width ? Math.floor(dc / span) * span : 0;
      cursor = { row: firstRow + i, col: dc - offset };
    }
    let text = shown.slice(offset, offset + width);
    if (offset > 0) text = `<${text.slice(1)}`;
    if (shown.length > offset + width) text = `${text.slice(0, width - 1)}>`;
    rows.push([{ text: fit(text, width) }]);
  }
  return { rows, cursor };
}
