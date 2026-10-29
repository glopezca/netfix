/** The pages beside the workspace (Ayuda, Configuración, Donaciones, Acerca de), built the first time they are shown. */
import { DocsView } from './docs-view.ts';
import { aboutView } from './about-view.ts';
import { donateView } from './donate-view.ts';
import { SettingsView } from './settings-view.ts';
import type { SettingsHost } from './settings-view.ts';

export type PageView = 'docs' | 'settings' | 'about' | 'donate';

export class Pages {
  private readonly built = new Map<PageView, HTMLElement>();
  private docs: DocsView | null = null;
  private settings: SettingsView | null = null;
  private readonly settingsHost: SettingsHost;

  constructor(settingsHost: SettingsHost) {
    this.settingsHost = settingsHost;
  }

  get(view: PageView): HTMLElement {
    const known = this.built.get(view);
    if (known) return known;
    if (view === 'settings') {
      this.settings = new SettingsView(this.settingsHost);
      this.built.set(view, this.settings.root);
      return this.settings.root;
    }
    if (view === 'docs') this.docs = new DocsView();
    const made = this.docs && view === 'docs' ? this.docs.root : view === 'about' ? aboutView() : donateView();
    this.built.set(view, made);
    return made;
  }

  /** The settings of the network open now (the page is kept between visits). */
  refreshSettings(): void {
    this.settings?.render();
  }

  /** Keyboard focus to the help search (when the help page exists). */
  focusDocs(): void {
    this.docs?.focus();
  }
}
