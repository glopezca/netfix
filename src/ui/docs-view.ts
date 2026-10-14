/** The Documentación tab: table of contents, search and pages (all text through textContent). */
import { t } from '../i18n/t.ts';
import { el, clear } from './dom.ts';
import { DOC_GROUPS, findPage, searchDocs } from '../docs/index.ts';
import type { DocPage } from '../docs/index.ts';
import { docBlock } from './doc-blocks.ts';

const FIRST_PAGE = 'inicio';

export class DocsView {
  readonly root: HTMLElement;
  private readonly toc: HTMLElement;
  private readonly article: HTMLElement;
  private readonly search: HTMLInputElement;
  private current = FIRST_PAGE;

  constructor() {
    this.search = el('input', { type: 'search', class: 'doc-search', placeholder: t('docs.searchHint'), 'aria-label': t('docs.searchLabel') });
    this.search.addEventListener('input', () => this.renderToc());
    this.toc = el('nav', { class: 'doc-toc', 'aria-label': t('docs.toc') });
    this.article = el('article', { class: 'doc-page', tabindex: '-1' });
    this.root = el('section', { class: 'docs', 'aria-label': t('docs.title') }, el('aside', { class: 'doc-side' }, this.search, this.toc), this.article);
    this.renderToc();
    this.show(FIRST_PAGE);
  }

  focus(): void {
    this.search.focus({ preventScroll: true });
  }

  show(id: string): void {
    const page = findPage(id) ?? findPage(FIRST_PAGE);
    if (!page) return;
    this.current = page.id;
    this.renderPage(page);
    for (const a of this.toc.querySelectorAll('button[data-page]')) a.setAttribute('aria-current', String(a.getAttribute('data-page') === page.id));
  }

  private link(page: DocPage, extra?: string): HTMLElement {
    const b = el('button', { type: 'button', class: 'doc-link', 'data-page': page.id, 'aria-current': String(page.id === this.current) },
      el('span', { class: 'doc-link-title' }, page.title), extra ? el('span', { class: 'doc-link-snippet' }, extra) : null);
    b.addEventListener('click', () => { this.show(page.id); this.article.focus({ preventScroll: true }); this.article.scrollTop = 0; });
    return b;
  }

  private renderToc(): void {
    clear(this.toc);
    const q = this.search.value.trim();
    if (q) {
      const hits = searchDocs(q);
      this.toc.append(el('p', { class: 'doc-count', role: 'status' }, hits.length ? (hits.length === 1 ? t('docs.onePage') : t('docs.pages', { n: hits.length })) : t('docs.noResults')),
        ...hits.map((h) => this.link(h.page, h.snippet)));
      return;
    }
    for (const g of DOC_GROUPS) this.toc.append(el('h2', { class: 'doc-group' }, g.title), ...g.pages.map((p) => this.link(p)));
  }

  private renderPage(page: DocPage): void {
    clear(this.article);
    const group = DOC_GROUPS.find((g) => g.pages.includes(page));
    this.article.append(el('p', { class: 'doc-crumb' }, group?.title ?? ''), el('h1', {}, page.title), el('p', { class: 'doc-summary' }, page.summary), ...page.blocks.map((b) => docBlock(b, page.markdownBase)));
  }
}
