/** The pages beside the workspace (Ayuda, Donaciones, Acerca de), built the first time they are shown. */
import { DocsView } from './docs-view.ts';
import { aboutView } from './about-view.ts';
import { donateView } from './donate-view.ts';

export type PageView = 'docs' | 'about' | 'donate';

export class Pages {
  private readonly built = new Map<PageView, HTMLElement>();
  private docs: DocsView | null = null;

  get(view: PageView): HTMLElement {
    const known = this.built.get(view);
    if (known) return known;
    if (view === 'docs') this.docs = new DocsView();
    const made = this.docs && view === 'docs' ? this.docs.root : view === 'about' ? aboutView() : donateView();
    this.built.set(view, made);
    return made;
  }

  /** Keyboard focus to the help search (when the help page exists). */
  focusDocs(): void {
    this.docs?.focus();
  }
}
