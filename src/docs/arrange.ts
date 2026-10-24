/** Fills an outline (src/docs/outline.ts, en/outline.ts) with the pages of the documentation. */
import type { DocGroup, DocPage } from './types.ts';
import type { OutlineGroup } from './outline.ts';

/** The groups of the Documentation tab: the outline filled with the pages (a page the outline misses is left out). */
export function arrange(outline: readonly OutlineGroup[], pages: readonly DocPage[]): DocGroup[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return outline.map((g) => ({
    id: g.id, title: g.title, ...(g.icon ? { icon: g.icon } : {}),
    pages: g.sections.flatMap(([section, ids]) => ids.flatMap((id) => {
      const page = byId.get(id);
      return page ? [section ? { ...page, section } : page] : [];
    })),
  }));
}
