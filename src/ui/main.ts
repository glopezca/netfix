/** Netfix application shell: top bar, workspace, palette, views, windows and simulation panel. */
import { applyBrand } from './brand.ts';
import { el, safeStorageGet, safeStorageSet } from './dom.ts';
import { Canvas } from './canvas.ts';
import type { Tool } from './canvas.ts';
import { WindowManager } from './windows.ts';
import { SimPanel } from './simpanel.ts';
import { MissionPanel } from './mission-panel.ts';
import { startLab, viewSolution } from '../labs/mission-build.ts';
import { missionById } from '../labs/missions.ts';
import { openDeviceWindow, forgetDevice, forgetAll } from './device-windows.ts';
import { afterPlaced } from './os-dialog.ts';
import { Topology } from '../net/topology.ts';
import { EXAMPLES } from '../net/examples.ts';
import { Pages } from './pages.ts';
import { applyDocumentLanguage, applyTheme, confirmUnsaved, loadTimestampPrompt } from './preferences.ts';
import { featureOn } from '../net/lab-features.ts';
import type { FeatureId, LabFeatures } from '../net/lab-features.ts';
import { topbar } from './topbar.ts';
import type { Mode, View } from './topbar.ts';
import { palette } from './palette.ts';
import { labText } from './lab-text.ts';
import { readTopologyFile, saveTopology } from './save-file.ts';
import { AUTOSAVE_KEY, MEMORY_STORE, SavedState, initialWorkspace, notifyHost } from './workspace-store.ts';
import type { KeyStore } from './workspace-store.ts';
import { confirmDialog, unsavedText } from './confirm-dialog.ts';
import type { Replacement } from './confirm-dialog.ts';
import { syncUndoButtons, undoShortcut } from './undo-keys.ts';
import { t } from '../i18n/t.ts';
import { DrawState, drawBar } from './draw-bar.ts';
import { detectLocale, setLocale, LOCALE_STORAGE_KEY } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { allowsLab, allowsTab, lockedPrompt } from '../classroom/restrictions.ts';
import { forceTimestampPrompt } from '../shells/prompt-clock.ts';
import type { DeviceKind } from '../net/topology.ts';
import { STANDALONE, checkMount, embedSession, evaluateFile, installApi } from '../classroom/embed.ts';
import type { AppSession, EmbedHandle } from '../classroom/embed.ts';

const BROWSER_STORE: KeyStore = { get: safeStorageGet, set: safeStorageSet };
const TICK_MS = 250;
const AUTOSAVE_DELAY_MS = 800;

class App {
  topo: Topology;
  readonly canvas: Canvas;
  readonly windows: WindowManager;
  readonly sim: SimPanel;
  private readonly mission: MissionPanel;
  private readonly hintEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly fileInput: HTMLInputElement;
  private readonly stageEl: HTMLElement;
  private readonly paletteEl: HTMLElement;
  private readonly pageHost: HTMLElement;
  private readonly pages = new Pages({ features: () => this.topo.features, setFeatures: (f) => this.setFeatures(f), webHideOff: () => this.topo.webHideOff, setWebHideOff: (on) => { this.topo.webHideOff = on; this.afterCommand(); }, labLocked: () => this.session.embedded, promptLocked: () => this.promptLock() !== undefined, setLocale: (l) => changeLocale(l) });
  private saveTimer = 0;
  private readonly interval: number;
  private mode: Mode = 'realtime';
  private readonly drawState = new DrawState();
  private readonly drawBarEl: HTMLElement;
  private view: View = 'net';
  private readonly session: AppSession;
  /** What was last loaded or saved to a file: opening a lab over other changes asks first. */
  private readonly saved: SavedState;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (this.session.policy.fileSave) void this.save();
      return;
    }
    if (this.undoKey(e) || (this.view === 'net' && this.workspaceActive && this.canvas.group.key(e))) return;
    // Nothing focused after the last click was on the workspace (its element was redrawn): its keys still apply.
    // A click anywhere else (a window, the bars) ends that, so Backspace there never deletes a device.
    const idle = document.activeElement === null || document.activeElement === document.body;
    if (idle && this.workspaceActive && this.view === 'net' && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) this.canvas.handleKey(e);
  };
  /** The last pointer went down on the workspace (not on a window, a bar or a page). */
  private workspaceActive = false;
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.workspaceActive = e.target instanceof Node && this.canvas.root.contains(e.target);
  };

  constructor(root: HTMLElement, session: AppSession, topo?: Topology, initial: { readonly view: View; readonly mode: Mode } = { view: 'net', mode: 'realtime' }) {
    this.session = session;
    this.saved = new SavedState(session.embedded ? MEMORY_STORE : BROWSER_STORE);
    this.mode = this.session.policy.simulation ? initial.mode : 'realtime';
    this.view = initial.view === 'docs' && !this.session.policy.docs ? 'net' : initial.view;
    this.topo = topo ?? initialWorkspace(BROWSER_STORE, this.saved, () => EXAMPLES[0]!.build());
    if (topo) this.saved.adopt(topo);
    this.hintEl = el('p', { class: 'hint', role: 'status' });
    this.clockEl = el('time', { class: 'clock' });
    this.canvas = new Canvas(this.topo, {
      open: (id) => this.open(id),
      changed: () => this.afterCommand(),
      hint: (text) => { this.hintEl.textContent = text; },
      removed: (id) => { this.windows.close(id); forgetDevice(id); },
      placed: (p) => afterPlaced(p, () => this.afterCommand()),
    }, this.drawState);
    this.canvas.restrict(this.session.policy);
    this.canvas.draw.locked = !this.session.policy.drawing;
    const winLayer = el('div', { class: 'win-layer' });
    this.windows = new WindowManager(winLayer);
    this.sim = new SimPanel(this.topo, this.canvas);
    this.mission = new MissionPanel(this.topo, { changed: () => this.scheduleSave(), solve: () => this.solve(), openDoc: (id) => this.openDoc(id) }, this.session.policy);
    this.drawBarEl = drawBar(this.drawState, {
      pick: (shape) => this.selectTool({ kind: 'draw', shape }, `draw-${shape}`),
      deleteSelected: () => { this.canvas.draw.deleteSelected(); this.canvas.root.focus({ preventScroll: true }); },
      deleteAll: () => {
        if (this.canvas.draw.count() === 0 || !globalThis.confirm(t('draw.confirmDeleteAll'))) return;
        this.canvas.draw.deleteAll();
      },
    }, this.toolButtons);
    this.stageEl = el('main', { class: 'stage' }, this.canvas.root, this.drawBarEl, this.mission.root, this.sim.root);
    this.paletteEl = palette({
      selectTool: (tool, key) => this.selectTool(tool, key), zoom: (a) => this.canvas.zoom(a), toggleDraw: () => this.toggleDraw(), undo: (redo) => this.undo(redo), clip: (a) => this.canvas.group.run(a),
    }, this.toolButtons, this.hintEl, this.session.policy);
    this.pageHost = el('main', { class: 'docs-host', hidden: true });
    this.fileInput = el('input', { type: 'file', accept: '.json,.netfix,application/json', hidden: true });
    this.fileInput.addEventListener('change', () => void this.openFile());
    root.replaceChildren(this.topbar(), this.stageEl, this.pageHost, this.paletteEl, winLayer, this.fileInput);
    this.canvas.setTool({ kind: 'select' });
    this.canvas.render();
    this.canvas.frameContent();
    this.interval = window.setInterval(() => this.tick(), TICK_MS);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.setMode(this.mode, false);
    this.showView(this.view);
    syncUndoButtons(this.paletteEl, this.canvas.edits());
    this.tick();
  }

  /** Where the user is (kept when the interface is rebuilt in another language). */
  where(): { readonly view: View; readonly mode: Mode } { return { view: this.view, mode: this.mode }; }

  /** Stops timers and listeners (before rebuilding the interface in another language). */
  dispose(): void {
    window.clearInterval(this.interval);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    if (!this.session.embedded || this.saveTimer) this.flushSave();
    this.windows.closeAll();
    this.sim.dispose();
    forgetAll();
  }

  /**
   * Lab, Nuevo or Abrir may replace the network: at once when nothing is unsaved, else only if the user agrees, and
   * never when the interface was rebuilt (another language) or the network replaced while the question was open.
   */
  private async replaceAllowed(what: Replacement): Promise<boolean> {
    if (document.querySelector('dialog[open]')) return false;
    const topo = this.topo;
    if (confirmUnsaved() && this.saved.dirty(topo) && !(await confirmDialog(unsavedText(what, this.session.policy.fileSave)))) return false;
    return app === this && this.topo === topo;
  }

  private topbar(): HTMLElement {
    return topbar({
      newWorkspace: () => void this.replaceAllowed('new').then((ok) => ok && this.load(new Topology(), t('hint.empty'))),
      openFile: () => void this.replaceAllowed('open').then((ok) => ok && this.fileInput.click()),
      save: () => void this.save(),
      loadExample: (id) => {
        const ex = EXAMPLES.find((e) => e.id === id && allowsLab(this.session.policy, id));
        const text = ex ? labText(ex) : null;
        if (ex && text) void this.replaceAllowed({ lab: text.title }).then((ok) => ok && this.load(startLab(ex), missionById(id) ? t('mission.ui.loaded', { title: text.title }) : text.summary));
      },
      advance: (ms) => this.advance(ms),
      setMode: (m) => this.setMode(m),
      showView: (v) => this.showView(v),
      setLocale: (l) => changeLocale(l),
    }, this.clockEl, this.mode, this.view, this.session.policy);
  }

  private setMode(m: Mode, hint = true): void {
    this.mode = m;
    this.sim.setActive(m === 'simulation');
    document.body.dataset.mode = m;
    if (hint) this.hintEl.textContent = t(m === 'simulation' ? 'hint.simulation' : 'hint.realtime');
  }

  /** Opens or closes the drawing bar; closing it goes back to the Select tool. */
  private toggleDraw(): boolean {
    this.drawBarEl.hidden = !this.drawBarEl.hidden;
    // A hidden bar leaves nothing selected: Del must not remove a drawing the user no longer sees as chosen.
    if (this.drawBarEl.hidden) this.canvas.draw.deselect();
    if (this.drawBarEl.hidden && this.canvas.currentTool().kind === 'draw') this.selectTool({ kind: 'select' }, 'select');
    return !this.drawBarEl.hidden;
  }

  private selectTool(tool: Tool, key: string): void {
    const same = this.toolButtons.get(key)?.getAttribute('aria-pressed') === 'true' && key !== 'select';
    const nextKey = same ? 'select' : key;
    for (const [k, b] of this.toolButtons) b.setAttribute('aria-pressed', String(k === nextKey));
    this.canvas.setTool(same ? { kind: 'select' } : tool);
    this.canvas.root.focus({ preventScroll: true });
  }

  /** Switches between the workspace and the pages (windows stay open but hidden). */
  private showView(view: View): void {
    if (view !== 'net') {
      const page = this.pages.get(view);
      if (page.parentElement !== this.pageHost) this.pageHost.replaceChildren(page);
    }
    this.stageEl.hidden = view !== 'net';
    this.paletteEl.hidden = view !== 'net';
    this.pageHost.hidden = view === 'net';
    document.body.dataset.view = view;
    this.view = view;
    if (view === 'docs') this.pages.focusDocs();
    if (view === 'settings') this.pages.refreshSettings();
  }

  private open(id: string): void { const placed = this.topo.get(id); if (placed) openDeviceWindow(placed, this); }

  /** Configuración → Laboratorio actual: windows reopen with the new tabs, and the change is unsaved work. */
  private setFeatures(next: LabFeatures): void {
    this.topo.features = next;
    this.windows.closeAll();
    this.afterCommand();
  }

  feature(kind: DeviceKind, id: FeatureId): boolean { return featureOn(this.topo.features, kind, id); }

  /** Tabs of the device windows left by the classroom restrictions. */
  allowsTab(kind: DeviceKind, tab: string): boolean { return allowsTab(this.session.policy, kind, tab); }

  /** Timestamp prompt locked by the classroom (true/false) or left to each device (undefined). */
  promptLock(): boolean | undefined { return lockedPrompt(this.session.policy); }

  /** Mission → View solution: the solved lab, keeping the hints read (the dialog already asked). */
  private solve(): void { if (this.topo.mission) this.load(viewSolution(this.topo.mission), t('mission.ui.solved')); }

  /** Mission → Para saber más: the Help view on that page, with the top bar showing Help. */
  private openDoc(id: string): void {
    this.showView('docs');
    this.pages.showDoc(id);
    for (const b of document.querySelectorAll<HTMLElement>('.topbar [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === 'docs'));
  }

  /** "PC0 (FastEthernet0)" at the far end of a cable, for the device windows. */
  peerLabel(device: string, port: string): string | undefined {
    const peer = this.topo.net.peerOf({ device, port });
    return peer ? `${this.topo.get(peer.device)?.label ?? peer.device} (${peer.port})` : undefined;
  }

  afterCommand(): void {
    this.topo.net.runFor(20);
    this.canvas.edits().syncDrawings(performance.now());
    this.canvas.render();
    syncUndoButtons(this.paletteEl, this.canvas.edits());
    this.scheduleSave();
  }

  /** Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z on the network view. */
  private undoKey(e: KeyboardEvent): boolean {
    const which = this.view === 'net' ? undoShortcut(e) : null;
    if (!which) return false;
    e.preventDefault();
    this.undo(which === 'redo');
    return true;
  }

  private undo(redo: boolean): void {
    const edits = this.canvas.edits();
    const done = redo ? edits.redo() : edits.undo();
    if (!done) {
      this.hintEl.textContent = t(redo ? 'undo.nothingRedo' : 'undo.nothingUndo');
      return;
    }
    for (const id of done.removed) { this.windows.close(id); forgetDevice(id); }
    this.canvas.clearSelection();
    this.afterCommand();
    const left = done.skipped ? ` ${t('undo.cablesLeft', { n: String(done.skipped) })}` : '';
    this.hintEl.textContent = t(redo ? 'undo.redone' : 'undo.undone', { what: t(`undo.${done.kind}`) }) + left;
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
    this.saved.mark(topo);
    this.canvas.setTopology(topo);
    this.sim.attach(topo);
    this.mission.attach(topo);
    syncUndoButtons(this.paletteEl, this.canvas.edits());
    this.pages.refreshSettings();
    this.hintEl.textContent = message;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), AUTOSAVE_DELAY_MS);
  }

  /** Autosave in the browser or, embedded, the change sent to the host page (never stored here). */
  private flushSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.session.embedded) safeStorageSet(AUTOSAVE_KEY, JSON.stringify(this.topo.toJSON()));
    else notifyHost(this.session, this.topo);
  }

  private async save(): Promise<void> {
    const done = await saveTopology(this.topo);
    if (done.saved) this.saved.mark(this.topo);
    this.hintEl.textContent = done.message;
  }

  private async openFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    const read = await readTopologyFile(file);
    if (typeof read === 'string') this.hintEl.textContent = read;
    else this.load(read, t('hint.opened', { name: file.name }));
  }

  /** Message for the status line after a language change. */
  announce(text: string): void { this.hintEl.textContent = text; }
}

let app: App | null = null;
let mountEl: HTMLElement | null = null;
let session: AppSession = STANDALONE;

/** Rebuilds the interface in another language, keeping the topology (open windows are closed). */
function changeLocale(locale: Locale): void {
  if (!session.embedded) safeStorageSet(LOCALE_STORAGE_KEY, locale);
  if (!mountEl || !app) return;
  const topo = app.topo;
  const where = app.where();
  app.dispose();
  setLocale(locale);
  applyDocumentLanguage();
  app = new App(mountEl, session, topo, where);
  app.announce(t('hint.language'));
}

/** Starts the interface in `mount` (one per page: a new start replaces the previous one). */
function start(mount: HTMLElement, s: AppSession, topo?: Topology): App {
  app?.dispose();
  app = null;
  if (mountEl && mountEl !== mount) mountEl.replaceChildren();
  mountEl = mount;
  session = s;
  MEMORY_STORE.clear();
  setLocale(detectLocale(s.embedded ? null : safeStorageGet(LOCALE_STORAGE_KEY), navigator.languages ?? [navigator.language]));
  applyDocumentLanguage();
  if (!s.embedded) { applyTheme(); loadTimestampPrompt(); } // embedded, the page (and its theme) belongs to the host
  applyBrand();
  // The lock reaches every shell, also the ones opened over SSH from inside the simulation.
  forceTimestampPrompt(lockedPrompt(s.policy));
  app = new App(mount, s, topo);
  return app;
}

installApi({
  embed: (mount, options): EmbedHandle => {
    checkMount(mount);
    const { session: s, topology } = embedSession(options);
    let last = start(mount, s, topology);
    // A language change rebuilds the App with the same session: the handle follows the current one.
    const current = (): App | null => (session === s ? app : null);
    return {
      exportTopology: () => (last = current() ?? last).topo.toJSON(),
      destroy: () => {
        const live = current();
        if (!live) return;
        last = live;
        live.dispose();
        app = null;
        forceTimestampPrompt(undefined);
        mount.replaceChildren();
      },
    };
  },
  evaluate: evaluateFile,
});

const mount = document.getElementById('app');
if (mount && mount.dataset.embed === undefined) start(mount, STANDALONE);
