/** A <pre> with vim's highlight groups as spans (textContent only: the content is never parsed as HTML). */
import { el } from './dom.ts';
import { filetypeOf, highlight } from '../editors/vim-syntax.ts';
import type { Filetype } from '../editors/vim-syntax.ts';

/** Replaces the content of `pre` with `text` highlighted as vim's `filetype`. */
export function fillSyntax(pre: HTMLElement, text: string, filetype: Filetype): HTMLElement {
  pre.replaceChildren();
  pre.classList.add('syn-view');
  pre.dataset.filetype = filetype;
  highlight(text, filetype).forEach((line, i) => {
    if (i) pre.append('\n');
    for (const s of line) pre.append(s.group ? el('span', { class: `syn-${s.group.toLowerCase()}` }, s.text) : s.text);
  });
  return pre;
}

/** A configuration file, with the filetype vim detects from its path. */
export function syntaxView(path: string, content: string): HTMLElement {
  return fillSyntax(el('pre', { class: 'log-view' }), content, filetypeOf(path));
}
