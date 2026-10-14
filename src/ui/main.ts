/** Netfix application shell: top bar, workspace, palette, views, windows and simulation panel. */
import { applyBrand } from './brand.ts';
import { el, safeStorageGet, safeStorageSet } from './dom.ts';
import { Canvas } from './canvas.ts';
import type { Tool } from './canvas.ts';
import { WindowManager } from './windows.ts';
import { SimPanel } from './simpanel.ts';
import { openDeviceWindow, forgetDevice, forgetAll } from './device-windows.ts';
import { Topology } from '../net/topology.ts';
import { EXAMPLES } from '../net/examples.ts';
import { DocsView } from './docs-view.ts';
import { aboutView } from './about-view.ts';
import { donateView } from './donate-view.ts';
import { topbar } from './topbar.ts';
import type { Mode, View } from './topbar.ts';
import { palette } from './palette.ts';
import { labText } from './lab-text.ts';
import { saveTopology } from './save-file.ts';
import { t } from '../i18n/t.ts';
import { detectLocale, getLocale, setLocale, LOCALE_STORAGE_KEY } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';

const AUTOSAVE_KEY = 'netfix:workspace:v1';
/** Workspace autosaved before the rename (netsim ≤ 0.4.0). */
const LEGACY_AUTOSAVE_KEY = 'netsim:workspace:v1';
const TICK_MS = 250;
const AUTOSAVE_DELAY_MS = 800;

class App {
  topo: Topology;
  readonly canvas: Canvas;
  readonly windows: WindowManager;
  readonly sim: SimPanel;
  private readonly hintEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly fileInput: HTMLInputElement;
  private readonly stageEl: HTMLElement;
  private readonly paletteEl: HTMLElement;
  private readonly pageHost: HTMLElement;
  private readonly pages = new Map<Exclude<View, 'net'>, HTMLElement>();
  private docs: DocsView | null = null;
  private saveTimer = 0;
  private readonly interval: number;
  private mode: Mode = 'realtime';
  private view: View = 'net';
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    }
  };

  constructor(root: HTMLElement, topo?: Topology, initial: { readonly view: View; readonly mode: Mode } = { view: 'net', mode: 'realtime' }) {
    this.mode = initial.mode;
    this.view = initial.view;
    this.topo = topo ?? this.initialTopology();
    this.hintEl = el('p', { class: 'hint', role: 'status' });
    this.clockEl = el('time', { class: 'clock' });
    this.canvas = new Canvas(this.topo, {
      open: (id) => this.open(id),
      changed: () => this.afterCommand(),
      hint: (text) => { this.hintEl.textContent = text; },
      removed: (id) => { this.windows.close(id); forgetDevice(id); },
    });
    const winLayer = el('div', { class: 'win-layer' });
    this.windows = new WindowManager(winLayer);
    this.sim = new SimPanel(this.topo, this.canvas);
    this.stageEl = el('main', { class: 'stage' }, this.canvas.root, this.sim.root);
    this.paletteEl = palette({ selectTool: (tool, key) => this.selectTool(tool, key), zoom: (a) => this.canvas.zoom(a) }, this.toolButtons, this.hintEl);
    this.pageHost = el('main', { class: 'docs-host', hidden: true });
    this.fileInput = el('input', { type: 'file', accept: '.json,.netfix,application/json', hidden: true });
    this.fileInput.addEventListener('change', () => void this.openFile());
    root.replaceChildren(this.topbar(), this.stageEl, this.pageHost, this.paletteEl, winLayer, this.fileInput);
    this.canvas.setTool({ kind: 'select' });
    this.canvas.render();
    this.canvas.frameContent();
    this.interval = window.setInterval(() => this.tick(), TICK_MS);
    window.addEventListener('keydown', this.onKeyDown);
    this.setMode(this.mode, false);
    this.showView(this.view);
    this.tick();
  }

  /** Where the user is (kept when the interface is rebuilt in another language). */
  where(): { readonly view: View; readonly mode: Mode } {
    return { view: this.view, mode: this.mode };
  }

  /** Stops timers and listeners (before rebuilding the interface in another language). */
  dispose(): void {
    window.clearInterval(this.interval);
    window.removeEventListener('keydown', this.onKeyDown);
    this.flushSave();
    this.windows.closeAll();
    this.sim.dispose();
    forgetAll();
  }

  private initialTopology(): Topology {
    const saved = safeStorageGet(AUTOSAVE_KEY) ?? safeStorageGet(LEGACY_AUTOSAVE_KEY);
    if (saved) {
      try {
        return Topology.fromJSON(JSON.parse(saved));
      } catch {
        // A corrupt autosave falls back to the first example.
      }
    }
    return EXAMPLES[0]!.build();
  }

  private topbar(): HTMLElement {
    return topbar({
      newWorkspace: () => this.load(new Topology(), t('hint.empty')),
      openFile: () => this.fileInput.click(),
      save: () => void this.save(),
      loadExample: (id) => {
        const ex = EXAMPLES.find((e) => e.id === id);
        if (ex) this.load(ex.build(), labText(ex).summary);
      },
      advance: (ms) => this.advance(ms),
      setMode: (m) => this.setMode(m),
      showView: (v) => this.showView(v),
      setLocale: (l) => changeLocale(l),
    }, this.clockEl, this.mode, this.view);
  }

  private setMode(m: Mode, hint = true): void {
    this.mode = m;
    this.sim.setActive(m === 'simulation');
    document.body.dataset.mode = m;
    if (hint) this.hintEl.textContent = t(m === 'simulation' ? 'hint.simulation' : 'hint.realtime');
  }

  private selectTool(tool: Tool, key: string): void {
    const same = this.toolButtons.get(key)?.getAttribute('aria-pressed') === 'true' && key !== 'select';
    const next: Tool = same ? { kind: 'select' } : tool;
    const nextKey = same ? 'select' : key;
    for (const [k, b] of this.toolButtons) b.setAttribute('aria-pressed', String(k === nextKey));
    this.canvas.setTool(next);
    this.canvas.root.focus({ preventScroll: true });
  }

  private page(view: Exclude<View, 'net'>): HTMLElement {
    const known = this.pages.get(view);
    if (known) return known;
    if (view === 'docs') this.docs = new DocsView();
    const made = view === 'docs' ? this.docs!.root : view === 'about' ? aboutView() : donateView();
    this.pages.set(view, made);
    return made;
  }

  /** Switches between the workspace and the pages (windows stay open but hidden). */
  private showView(view: View): void {
    if (view !== 'net') {
      const page = this.page(view);
      if (page.parentElement !== this.pageHost) this.pageHost.replaceChildren(page);
    }
    this.stageEl.hidden = view !== 'net';
    this.paletteEl.hidden = view !== 'net';
    this.pageHost.hidden = view === 'net';
    document.body.dataset.view = view;
    this.view = view;
    if (view === 'docs') this.docs?.focus();
  }

  private open(id: string): void {
    const placed = this.topo.get(id);
    if (placed) openDeviceWindow(placed, this);
  }

  /** "PC0 (FastEthernet0)" at the far end of a cable, for the device windows. */
  peerLabel(device: string, port: string): string | undefined {
    const peer = this.topo.net.peerOf({ device, port });
    return peer ? `${this.topo.get(peer.device)?.label ?? peer.device} (${peer.port})` : undefined;
  }

  afterCommand(): void {
    this.topo.net.runFor(20);
    this.canvas.render();
    this.scheduleSave();
  }

  private tick(): void {
    if (this.mode === 'realtime' || this.topo.net.pending() > 0) this.topo.net.runFor(TICK_MS);
    const now = new Date(this.topo.clock.now());
    this.clockEl.textContent = t('clock.utc', { time: now.toISOString().slice(11, 19) });
    this.clockEl.setAttribute('datetime', now.toISOString());
    this.canvas.requestRender();
  }

  private advance(ms: number): void {
    this.topo.net.runFor(ms);
    this.hintEl.textContent = t('hint.advanced');
    this.afterCommand();
  }

  load(topo: Topology, message: string): void {
    this.windows.closeAll();
    forgetAll();
    this.topo = topo;
    this.canvas.setTopology(topo);
    this.sim.attach(topo);
    this.hintEl.textContent = message;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), AUTOSAVE_DELAY_MS);
  }

  private flushSave(): void {
    window.clearTimeout(this.saveTimer);
    safeStorageSet(AUTOSAVE_KEY, JSON.stringify(this.topo.toJSON()));
  }

  private async save(): Promise<void> {
    this.hintEl.textContent = await saveTopology(this.topo);
  }

  private async openFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      this.load(Topology.fromJSON(JSON.parse(await file.text())), t('hint.opened', { name: file.name }));
    } catch (err) {
      this.hintEl.textContent = t('hint.openFailed', { name: file.name, error: err instanceof Error ? err.message : t('hint.unknownFormat') });
    }
  }

  /** Message for the status line after a language change. */
  announce(text: string): void {
    this.hintEl.textContent = text;
  }
}

let app: App | null = null;
let mountEl: HTMLElement | null = null;

function applyDocumentLanguage(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}

/** Rebuilds the interface in another language, keeping the topology (open windows are closed). */
function changeLocale(locale: Locale): void {
  safeStorageSet(LOCALE_STORAGE_KEY, locale);
  if (!mountEl || !app) return;
  const topo = app.topo;
  const where = app.where();
  app.dispose();
  setLocale(locale);
  applyDocumentLanguage();
  app = new App(mountEl, topo, where);
  app.announce(t('hint.language'));
}

const mount = document.getElementById('app');
if (mount) {
  mountEl = mount;
  setLocale(detectLocale(safeStorageGet(LOCALE_STORAGE_KEY), navigator.languages ?? [navigator.language]));
  applyDocumentLanguage();
  applyBrand();
  app = new App(mount);
}
