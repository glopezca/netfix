/** The Documentation tab: table of contents, search and pages (all text through textContent). */
import { t } from '../i18n/t.ts';
import { el, clear, staticSvg } from './dom.ts';
import { ICONS } from './icons.ts';
import { TOPIC_ICONS } from './doc-icons.ts';
import { brandImage } from './brand.ts';
import { docGroups, findPage, searchDocs } from '../docs/index.ts';
import type { DocGroup, DocPage } from '../docs/index.ts';
import { docBlock } from './doc-blocks.ts';

const FIRST_PAGE = 'inicio';

export class DocsView {
  readonly root: HTMLElement;
  private readonly toc: HTMLElement;
  private readonly article: HTMLElement;
  private readonly search: HTMLInputElement;
  private current = FIRST_PAGE;
  /** Groups the reader unfolded (kept across searches and redraws). */
  private readonly opened = new Set<string>();

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
    // The group of the page opens (the others keep how the reader left them).
    for (const d of this.toc.querySelectorAll<HTMLDetailsElement>('details[data-group]')) {
      if (d.querySelector(`button[data-page="${CSS.escape(page.id)}"]`)) d.open = true;
    }
  }

  private link(page: DocPage, extra?: string, nested = false): HTMLElement {
    const b = el('button', { type: 'button', class: nested ? 'doc-link doc-link-nested' : 'doc-link', 'data-page': page.id, 'aria-current': String(page.id === this.current) },
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
    for (const g of docGroups()) this.toc.append(this.groupBox(g));
  }

  /** A group: its icon and title (folds), then its sections as subheadings and the pages indented below them. */
  private groupBox(g: DocGroup): HTMLElement {
    // Devices: their palette icon; topics (concepts, terminal, bash): theirs; Netfix: its N.
    const art = g.icon === undefined ? undefined : g.icon === 'network' || g.icon === 'terminal' || g.icon === 'script' ? TOPIC_ICONS[g.icon] : ICONS[g.icon];
    const icon = art ? staticSvg(art) : g.id === 'netfix' ? brandImage('isologoN', 'doc-group-brand', '') : el('span', { class: 'doc-group-dot', 'aria-hidden': 'true' });
    icon.classList.add('doc-group-icon');
    const items: HTMLElement[] = [];
    let section: string | undefined;
    for (const p of g.pages) {
      if (p.section !== section) {
        section = p.section;
        if (section) items.push(el('h3', { class: 'doc-section' }, section));
      }
      items.push(this.link(p, undefined, p.section !== undefined));
    }
    const box = el('details', { class: 'doc-group-box', 'data-group': g.id, open: this.opened.has(g.id) || g.pages.some((p) => p.id === this.current) },
      el('summary', { class: 'doc-group' }, icon, el('span', { class: 'doc-group-title', role: 'heading', 'aria-level': '2' }, g.title),
        el('span', { class: 'doc-group-count', 'aria-label': t('docs.pages', { n: g.pages.length }) }, String(g.pages.length))),
      el('div', { class: 'doc-group-pages' }, ...items));
    box.addEventListener('toggle', () => { if (box.open) this.opened.add(g.id); else this.opened.delete(g.id); });
    return box;
  }

  private renderPage(page: DocPage): void {
    clear(this.article);
    const group = docGroups().find((g) => g.pages.includes(page));
    const crumb = [group?.title, page.section].filter(Boolean).join(' › ');
    this.article.append(el('p', { class: 'doc-crumb' }, crumb), el('h1', {}, page.title), el('p', { class: 'doc-summary' }, page.summary), ...page.blocks.map((b) => docBlock(b, page.markdownBase)));
  }
}
