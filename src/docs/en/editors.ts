/** Documentation: the nano and vim editors in the Linux Terminal. */
import type { DocPage } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const NANO_KEYS: readonly (readonly [string, string])[] = [
  ['Ctrl+O', 'Save (Write Out): confirm or change the name and press Enter'],
  ['Ctrl+S', 'Save without asking'],
  ['Ctrl+X', 'Exit; if there are changes it asks “Save modified buffer?” (Y / N / Ctrl+C)'],
  ['Ctrl+F (or Ctrl+W)', 'Search; Alt+W repeats the search'],
  ['Ctrl+\\', 'Search and replace: Y (this one), N (next), A (all)'],
  ['Ctrl+K · Ctrl+U', 'Cut the line (several in a row accumulate) · paste'],
  ['Alt+U · Alt+E', 'Undo · redo'],
  ['Ctrl+_ (or Ctrl+/)', 'Go to line (and column)'],
  ['Ctrl+C', 'Cursor position; in a dialogue, cancel'],
  ['Ctrl+G', 'Help (Ctrl+X closes it)'],
  ['Ctrl+A · Ctrl+E · Home · End', 'Start and end of the line'],
  ['Ctrl+Y · Ctrl+V · PgUp · PgDn', 'Previous / next page'],
  ['Alt+\\ · Alt+/', 'First / last line'],
];

export const VIM_KEYS: readonly (readonly [string, string])[] = [
  ['i a I A o O', 'Enter insert mode (before, after, start, end, new line below / above)'],
  ['Esc', 'Return to normal mode'],
  ['h j k l · arrows', 'Move the cursor (they accept a count: 5j)'],
  ['w b e · 0 ^ $', 'Next / previous / end of word · start, first character, end of line'],
  ['gg · G · NG · :N', 'First line · last · line N'],
  ['f{c} F{c} t{c} T{c}', 'Jump to a character on the line'],
  ['x X · r{c} · ~ · J', 'Delete character · replace · toggle case · join lines'],
  ['dd · D · dw · d$ · dG · 3dd', 'Delete (the lines or the motion)'],
  ['cc · C · cw · s · S', 'Change (deletes and enters insert mode)'],
  ['yy · Y · yw · p · P', 'Copy · paste after / before'],
  ['u · Ctrl+R · .', 'Undo · redo · repeat the last change'],
  ['/text · ?text · n · N · *', 'Search forwards / backwards · next / previous · the word under the cursor'],
  ['Ctrl+F · Ctrl+B · Ctrl+D · Ctrl+U · Ctrl+G', 'Page or half-page forwards / backwards · file information'],
  ['ZZ · ZQ', 'Save and exit · exit without saving'],
];

export const VIM_EX: readonly (readonly [string, string])[] = [
  [':w [file] · :w!', 'Save (with ! even if read-only)'],
  [':q · :q!', 'Exit · exit discarding changes'],
  [':wq · :x', 'Save and exit'],
  [':e!', 'Revert to the version on disk'],
  [':N · :$', 'Go to line N · to the last one'],
  [':s/a/b/ · :s/a/b/g · :%s/a/b/g', 'Substitute on the line / in the whole file (& and \\1 in the replacement)'],
  [':d', 'Delete the line'],
  [':set nu · :set nonu', 'Show or hide line numbers'],
  [':set ro · :set noro', 'Read-only'],
];

export const EDITOR_DOCS: readonly DocPage[] = [
  {
    id: 'nano',
    title: 'nano',
    summary: 'GNU nano 8.4: keys, dialogues and messages.',
    blocks: [
      code('nano file             # opens (or creates on saving)\nnano +25 file         # at line 25\nsudo nano /etc/hosts  # root’s files\nnano -v file          # read-only'),
      p('The screen has the title bar (version, name and “Modified” if there are changes), the text, the status line ([ Read 3 lines ], [ Wrote 3 lines ], [ New File ]…) and two rows of shortcuts. ^ means Ctrl and M- means Alt.'),
      table(['Key', 'Action'], NANO_KEYS),
      note('The browser reserves Ctrl+W, Ctrl+N and Ctrl+T: to search use Ctrl+F, which is nano 8’s own shortcut.'),
      p('When saving a file without permission, nano shows “[ Error writing /etc/hosts: Permission denied ]” and does not close: exit with Ctrl+X → N and open it again with sudo.'),
    ],
  },
  {
    id: 'vim',
    title: 'vim',
    summary: 'Vi IMproved 9.1: modes, motion and editing commands, colon commands.',
    blocks: [
      code('vim file     vi file     view file (read-only)     vim +10 file'),
      p('vim has modes. It opens in normal mode (keys are commands); i enters insert mode (“-- INSERT --” at the bottom) and Esc returns. : opens the command line. At the bottom right are the position (line,column) and All/Top/Bot or the percentage.'),
      h('Normal mode'),
      table(['Keys', 'Action'], VIM_KEYS),
      h('Colon commands'),
      table(['Command', 'Action'], VIM_EX),
      h('Common messages'),
      list(
        'E37: No write since last change (add ! to override) — :q with unsaved changes.',
        "E45: 'readonly' option is set (add ! to override) — read-only file.",
        'W10: Warning: Changing a readonly file — you start modifying a read-only one.',
        '"f" E212: Can\'t open file for writing — no permission: :q! and sudo vim f.',
        'E486: Pattern not found: x · E492: Not an editor command: x · E32: No file name.',
      ),
      note('Visual (v, V) and replace (R) modes are not available in Netfix.'),
    ],
  },
];
