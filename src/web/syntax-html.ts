/** A <pre> of the simulated web pages with vim's highlight groups as spans (h() escapes every text). */
import { h } from './html.ts';
import type { Child } from './html.ts';
import { highlight } from '../editors/vim-syntax.ts';
import type { Filetype } from '../editors/vim-syntax.ts';

export function syntaxPre(text: string, filetype: Filetype, cls = 'web-adm-log'): Child {
  const lines = highlight(text, filetype).map((line, i) => [i ? '\n' : '', ...line.map((s) => (s.group ? h('span', { class: `syn-${s.group.toLowerCase()}` }, s.text) : s.text))]);
  return h('pre', { class: `${cls} syn-view`, 'data-filetype': filetype }, lines);
}
