/**
 * A <pre> of the simulated web pages with vim's highlight groups as spans (h() escapes every text). The simulated
 * browser keeps only `web-*` classes (ui/html-render.ts), so the groups and the filetype are `web-syn-*` classes.
 */
import { h } from './html.ts';
import type { Child } from './html.ts';
import { highlight } from '../editors/vim-syntax.ts';
import type { Filetype } from '../editors/vim-syntax.ts';

export function syntaxPre(text: string, filetype: Filetype, cls = 'web-adm-log'): Child {
  const lines = highlight(text, filetype).map((line, i) => [i ? '\n' : '', ...line.map((s) => (s.group ? h('span', { class: `web-syn-${s.group.toLowerCase()}` }, s.text) : s.text))]);
  return h('pre', { class: `${cls} web-syn-view web-syn-${filetype}` }, lines);
}
