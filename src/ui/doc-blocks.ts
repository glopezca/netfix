/** Renders documentation blocks as DOM (text through textContent; links only http/https). */
import { el } from './dom.ts';
import type { DocBlock } from '../docs/index.ts';
import { inlineMarkdown } from '../docs/markdown.ts';

type Child = Node | string;

/** Plain text, or inline Markdown when the page declares a base URL for its links. */
export function inline(text: string, markdownBase?: string): Child[] {
  if (markdownBase === undefined) return [text];
  return inlineMarkdown(text, markdownBase).map((s) => {
    const body: Node | string = s.code ? el('code', {}, s.text) : s.bold ? el('strong', {}, s.text) : s.text;
    return s.href ? el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, body) : body;
  });
}

export function docBlock(b: DocBlock, md?: string): HTMLElement {
  switch (b.kind) {
    case 'p': return el('p', {}, ...inline(b.text, md));
    case 'h': return b.level === 4 ? el('h4', {}, ...inline(b.text, md)) : el('h3', {}, ...inline(b.text, md));
    case 'code': return el('pre', { class: 'doc-code' }, el('code', {}, b.text));
    case 'note': return el('p', { class: 'doc-note' }, ...inline(b.text, md));
    case 'list': return el('ul', {}, ...b.items.map((i) => el('li', {}, ...inline(i, md))));
    case 'table':
      return el('div', { class: 'doc-table-wrap' }, el('table', { class: 'doc-table' },
        el('thead', {}, el('tr', {}, ...b.head.map((c) => el('th', { scope: 'col' }, ...inline(c, md))))),
        el('tbody', {}, ...b.rows.map((r) => el('tr', {}, ...r.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, ...inline(c, md)) : el('td', {}, ...inline(c, md)))))))));
  }
}
