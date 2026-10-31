/** Renders documentation blocks as DOM (text through textContent; links only http/https). */
import { el } from './dom.ts';
import type { DocBlock } from '../docs/index.ts';
import { inlineMarkdown } from '../docs/markdown.ts';
import { t } from '../i18n/t.ts';
import { docFigure } from './doc-figures.ts';
import { docTerm } from './doc-term.ts';

type Child = Node | string;

const TONES = { tip: 'docs.tone.tip', warn: 'docs.tone.warn', check: 'docs.tone.check', exercise: 'docs.tone.exercise' } as const;

/** Plain text, or inline Markdown when the page declares a base URL for its links. */
export function inline(text: string, markdownBase?: string): Child[] {
  if (markdownBase === undefined) return [text];
  return inlineMarkdown(text, markdownBase).map((s) => {
    const body: Node | string = s.code ? el('code', {}, s.text) : s.bold ? el('strong', {}, s.text) : s.text;
    return s.href ? el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, body) : body;
  });
}

/** «Ejercicio · Reserva la .60»; the kind alone when the title already says it («Errores típicos», «Compruébalo»). */
function calloutTitle(kind: string, title: string, md?: string): Child[] {
  const key = (x: string): string => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().slice(0, 5);
  return key(title) === key(kind) ? inline(title, md) : [kind, ' · ', ...inline(title, md)];
}

export function docBlock(b: DocBlock, md?: string): HTMLElement {
  switch (b.kind) {
    case 'p': return el('p', {}, ...inline(b.text, md));
    case 'h': return b.level === 4 ? el('h4', {}, ...inline(b.text, md)) : el('h3', {}, ...inline(b.text, md));
    case 'code': return el('pre', { class: 'doc-code' }, el('code', {}, b.text));
    case 'note': return el('p', { class: 'doc-note' }, ...inline(b.text, md));
    case 'list': return el('ul', {}, ...b.items.map((i) => el('li', {}, ...inline(i, md))));
    case 'steps':
      return el('ol', { class: 'doc-steps' }, ...b.items.map((s) => el('li', {}, el('strong', { class: 'doc-step-title' }, ...inline(s.title, md)), el('span', {}, ...inline(s.text, md)))));
    case 'callout':
      return el('aside', { class: `doc-callout doc-callout-${b.tone}`, role: 'note' },
        el('p', { class: 'doc-callout-title' }, ...calloutTitle(t(TONES[b.tone]), b.title, md)), el('p', {}, ...inline(b.text, md)),
        b.solution ? el('details', { class: 'doc-solution' }, el('summary', {}, b.solutionLabel ?? t('docs.solution')),
          ...b.solution.split('\n\n').map((s) => el('p', {}, ...inline(s, md)))) : null);
    case 'figure': return docFigure(b.figure, b.caption);
    case 'term': return docTerm(b.lang, b.text);
    case 'table':
      return el('div', { class: 'doc-table-wrap' }, el('table', { class: 'doc-table' },
        el('thead', {}, el('tr', {}, ...b.head.map((c) => el('th', { scope: 'col' }, ...inline(c, md))))),
        el('tbody', {}, ...b.rows.map((r) => el('tr', {}, ...r.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, ...inline(c, md)) : el('td', {}, ...inline(c, md)))))))));
  }
}
