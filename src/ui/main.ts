/** Netfix application shell: top bar, workspace, palette, views, windows and simulation panel. */
import { ClassLanState, askClass } from './lan-chooser.ts';
import { mountCode } from './code-mount.ts';
import { applyBrand, removeBrand } from './brand.ts';
import { el, safeStorageGet, safeStorageSet } from './dom.ts';
import { Canvas } from './canvas.ts';
import type { Tool } from './canvas.ts';
import { WindowManager } from './windows.ts';
import { SimPanel } from './simpanel.ts';
import { MissionPanel } from './mission-panel.ts';
import { startLab, viewSolution } from '../labs/mission-build.ts';
import { missionById } from '../labs/missions.ts';
import { openDeviceWindow, forgetDevice, forgetAll } from './device-windows.ts';
import { clearClipboard } from './group-select.ts';
import { afterPlaced } from './os-dialog.ts';
import { Topology } from '../net/topology.ts';
import { EXAMPLES } from '../net/examples.ts';
import { Pages } from './pages.ts';
import { applyDocumentLanguage, applyTheme, confirmUnsaved, classroomMissions, loadMissionsPref, loadTimestampPrompt, missionsShown, onDevicePiles, overrideConfirmUnsaved, overrideDevicePiles, setToolHelp, toolHelp } from './preferences.ts';
import { featureOn } from '../net/lab-features.ts';
import type { FeatureId, LabFeatures } from '../net/lab-features.ts';
import { floatBar, topbar } from './topbar.ts';
import type { Mode, TopbarActions, View } from './topbar.ts';
import { deviceGroup, palette, syncOneOnlyButtons, type PaletteActions } from './palette.ts';
import { offerClassLan, registerClassLanUi } from './classlan-kind.ts';
import { CLASSLAN_KIND, registerClassLanKind } from '../devices/classlan-kind.ts';
import { labText } from './lab-text.ts';
import { readTopologyFile, saveTopology } from './save-file.ts';
import { AUTOSAVE_KEY, MEMORY_STORE, SavedState, initialWorkspace, notifyHost } from './workspace-store.ts';
import type { KeyStore } from './workspace-store.ts';
import { confirmDialog, unsavedText } from './confirm-dialog.ts';
import type { Replacement } from './confirm-dialog.ts';
import { syncUndoButtons, undoShortcut } from './undo-keys.ts';
import { t } from '../i18n/t.ts';
import { DrawState, drawBar } from './draw-bar.ts';
import { detectLocale, getLocale, isLocale, setLocale, LOCALE_STORAGE_KEY } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { allowsLab, allowsTab, lockedPrompt } from '../classroom/restrictions.ts';
import { forceTimestampPrompt } from '../shells/prompt-clock.ts';
import { formatToolbarClock } from '../core/clock.ts';
import type { DeviceKind } from '../net/topology.ts';
import { STANDALONE, embedSession, evaluateFile } from '../classroom/embed.ts';
import { NO_HOST, checkMount, labOptions, takeHostOptions } from './embed-api.ts';
import type { HostOptions } from './embed-api.ts';
import type { NetfixApi } from './embed-api.ts';
import type { AppSession, EmbedHandle } from '../classroom/embed.ts';

const BROWSER_STORE: KeyStore = { get: safeStorageGet, set: safeStorageSet };
const TICK_MS = 250;
const AUTOSAVE_DELAY_MS = 800;
const NOTE_MS = 6000;

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
  /** The top bar: at the top of the mount, or in the host page's element (`toolbar` option). */
  private readonly barEl: HTMLElement;
  /** The bar is in a host page's menu: the host owns the language, theme, help, about and the unsaved question. */
  private readonly hosted: boolean;
  /** Hosted: undo/redo, clipboard and zoom, in the host's `actions` element (or at the foot of the sidebar). */
  private readonly actionsBox: HTMLElement | null;
  /** Hosted: the hint line as a note over the workspace (tool help that can be turned off; messages for a while). */
  private readonly note: HTMLElement | null;
  private noteWatch: MutationObserver | null = null;
  private noteTimer = 0;
  /** The text just put in the hint line is a tool's help (the canvas's), not a message. */
  private helpPending = false;
  private readonly stageEl: HTMLElement;
  private readonly paletteEl: HTMLElement;
  private pilesWatch: (() => void) | null = null;
  private readonly pageHost: HTMLElement;
  private readonly pages = new Pages({ features: () => this.topo.features, setFeatures: (f) => this.setFeatures(f), webHideOff: () => this.topo.webHideOff, setWebHideOff: (on) => { this.topo.webHideOff = on; this.afterCommand(); }, pkgsOff: () => this.topo.pkgsOff, setPkgsOff: (p) => { this.topo.pkgsOff = p; this.windows.closeAll(); this.afterCommand(); }, labLocked: () => this.session.embedded, hostOwned: () => this.hosted, promptLocked: () => this.promptLock() !== undefined, setLocale: (l) => changeLocale(l) });
  private saveTimer = 0;
  private readonly interval: number;
  private mode: Mode = 'realtime';
  private readonly drawState = new DrawState();
  private readonly drawBarEl: HTMLElement;
  private view: View = 'net';
  private readonly session: AppSession;
  /** The mount: it carries .netfix-root and the current view and mode (never the host page's <body>). */
  private readonly rootEl: HTMLElement;
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

  constructor(root: HTMLElement, session: AppSession, topo?: Topology, initial: { readonly view: View; readonly mode: Mode } = { view: 'net', mode: 'realtime' }, hostBar: HTMLElement | null = null, hostActions: HTMLElement | null = null) {
    this.rootEl = root;
    this.hosted = hostBar !== null;
    this.session = session;
    this.saved = new SavedState(session.embedded ? MEMORY_STORE : BROWSER_STORE);
    this.mode = this.session.policy.simulation ? initial.mode : 'realtime';
    this.view = initial.view === 'docs' && !this.session.policy.docs ? 'net' : initial.view;
    this.topo = topo ?? initialWorkspace(BROWSER_STORE, this.saved, () => EXAMPLES[0]!.build());
    this.topo.setKindContext(CLASSLAN_KIND, classLan.current);
    this.topo.clock.set(Date.now()); // the settle ran the lab ~30 s ahead: its wall clock is the system's (like `clock set`)
    if (topo) this.saved.adopt(topo);
    this.hintEl = el('p', { class: 'hint', role: 'status' });
    this.clockEl = el('time', { class: 'clock' });
    this.canvas = new Canvas(this.topo, {
      open: (id) => this.open(id),
      changed: () => this.afterCommand(),
      hint: (text) => { this.helpPending = true; this.hintEl.textContent = text; },
      removed: (id) => { this.windows.close(id); forgetDevice(id); },
      placed: (p, system) => afterPlaced(p, () => this.afterCommand(), system),
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
    this.note = this.hosted ? this.hintNote() : null;
    // Hosted, the clock, the mode and the hint float over the workspace, which a wrapper frames (it scrolls itself).
    const workspace = this.note ? el('div', { class: 'ws-wrap' }, this.canvas.root, floatBar(this.barActions(), this.clockEl, this.mode, this.session.policy), this.note) : this.canvas.root;
    this.stageEl = el('main', { class: 'stage' }, workspace, this.drawBarEl, this.mission.root, this.sim.root);
    this.actionsBox = this.hosted ? el('div', { class: 'nf-actions', role: 'group', 'aria-label': t('undo.group') }) : null;
    const palActions: PaletteActions = {
      selectTool: (tool, key) => this.selectTool(tool, key), zoom: (a) => this.canvas.zoom(a), toggleDraw: () => this.toggleDraw(), undo: (redo) => this.undo(redo), clip: (a) => this.canvas.group.run(a),
    };
    this.paletteEl = palette(palActions, this.toolButtons, this.hintEl, this.session.policy, this.actionsBox);
    // The piles setting redraws only the devices (the tool goes back to Select: its button may be gone).
    this.pilesWatch = onDevicePiles(() => {
      for (const k of [...this.toolButtons.keys()]) if (k.startsWith('place-')) this.toolButtons.delete(k);
      const fresh = deviceGroup(palActions, this.toolButtons, this.session.policy);
      const old = this.paletteEl.querySelector('.pal-devices');
      if (old && fresh) old.replaceWith(fresh);
      this.selectTool({ kind: 'select' }, 'select');
      this.syncClassLan();
    });
    this.syncClassLan();
    if (this.actionsBox) (hostActions ?? this.paletteEl).append(this.actionsBox);
    this.pageHost = el('main', { class: 'docs-host', hidden: true });
    this.fileInput = el('input', { type: 'file', accept: '.json,.netfix,application/json', hidden: true });
    this.fileInput.addEventListener('change', () => void this.openFile());
    this.barEl = this.topbar(this.hosted);
    hostBar?.replaceChildren(this.barEl);
    root.replaceChildren(...(hostBar ? [] : [this.barEl]), this.stageEl, this.pageHost, this.paletteEl, winLayer, this.fileInput);
    this.canvas.setTool({ kind: 'select' });
    this.canvas.render();
    this.canvas.frameContent();
    this.interval = window.setInterval(() => this.tick(), TICK_MS);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.setMode(this.mode, false);
    this.showView(this.view);
    syncUndoButtons(this.actionsBox ?? this.paletteEl, this.canvas.edits());
    this.tick();
  }

  /** Where the user is (kept when the interface is rebuilt in another language). */
  where(): { readonly view: View; readonly mode: Mode } { return { view: this.view, mode: this.mode }; }

  /** Stops timers and listeners (before rebuilding the interface in another language). */
  dispose(): void {
    window.clearInterval(this.interval);
    window.removeEventListener('keydown', this.onKeyDown);
    this.pilesWatch?.();
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.noteWatch?.disconnect();
    window.clearTimeout(this.noteTimer);
    if (!this.session.embedded || this.saveTimer) this.flushSave();
    this.windows.closeAll();
    this.sim.dispose();
    this.mission.dispose(); this.pages.dispose();
    forgetAll();
  }

  /** Lab, Nuevo or Abrir may replace the network: at once when nothing is unsaved, else only if the user agrees, and
   * never when the interface was rebuilt (another language) or the network replaced while the question was open. */
  private async replaceAllowed(what: Replacement): Promise<boolean> {
    if (document.querySelector('dialog[open]')) return false;
    const topo = this.topo;
    if (confirmUnsaved() && this.saved.dirty(topo) && !(await confirmDialog(unsavedText(what, this.session.policy.fileSave)))) return false;
    return app === this && this.topo === topo;
  }

  /** The note over the workspace that takes the hint line: tool help until closed (unless turned off), messages for 6 s. */
  private hintNote(): HTMLElement {
    const close = el('button', { type: 'button', class: 'hint-close', 'aria-label': t('hint.close'), title: t('hint.close') }, '×');
    const never = el('input', { type: 'checkbox' });
    const note = el('div', { class: 'hint-note', hidden: true }, this.hintEl,
      el('label', { class: 'hint-never' }, never, t('hint.noMoreHelp')), close);
    close.addEventListener('click', () => { note.hidden = true; });
    never.addEventListener('change', () => { if (never.checked) { setToolHelp(false); note.hidden = true; } });
    this.noteWatch = new MutationObserver(() => {
      const help = this.helpPending;
      this.helpPending = false;
      window.clearTimeout(this.noteTimer);
      note.dataset.kind = help ? 'help' : 'message';
      note.hidden = !this.hintEl.textContent || (help && !toolHelp());
      if (!help) this.noteTimer = window.setTimeout(() => { note.hidden = true; }, NOTE_MS);
    });
    this.noteWatch.observe(this.hintEl, { childList: true, characterData: true, subtree: true });
    return note;
  }

  private topbar(hosted: boolean): HTMLElement {
    return topbar(this.barActions(), this.clockEl, this.mode, this.view, this.session.policy, hosted);
  }

  private barActions(): TopbarActions {
    return {
      newWorkspace: () => void this.replaceAllowed('new').then((ok) => ok && this.load(new Topology(), t('hint.empty'))),
      openFile: () => void this.replaceAllowed('open').then((ok) => ok && this.fileInput.click()),
      save: () => void this.save(),
      loadExample: (id) => {
        const ex = EXAMPLES.find((e) => e.id === id && allowsLab(this.session.policy, id));
        const text = ex ? labText(ex) : null;
        if (ex && text) void this.replaceAllowed({ lab: text.title }).then((ok) => ok && this.load(startLab(ex), missionById(id) && missionsShown() ? t('mission.ui.loaded', { title: text.title }) : text.summary));
      },
      advance: (ms) => this.advance(ms),
      setMode: (m) => this.setMode(m),
      showView: (v) => this.showView(v),
      setLocale: (l) => changeLocale(l),
    };
  }

  private setMode(m: Mode, hint = true): void {
    this.mode = m;
    this.sim.setActive(m === 'simulation');
    this.rootEl.dataset.mode = m;
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
    if (!same && key === 'place-classlan' && classLan.needsJoin) { void this.joinClassLan(tool, key); return; }
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
    if (this.actionsBox) this.actionsBox.hidden = view !== 'net';
    this.pageHost.hidden = view === 'net';
    this.rootEl.dataset.view = view;
    this.view = view;
    if (view === 'docs') this.pages.focusDocs();
    if (view === 'settings') this.pages.refreshSettings();
  }

  private open(id: string): void { const placed = this.topo.get(id); if (placed) openDeviceWindow(placed, this); }

  /** Configuración → Laboratorio actual: windows reopen with the new tabs, and the change is unsaved work. */
  private setFeatures(next: LabFeatures): void {
    this.topo.setFeatures(next);
    this.windows.closeAll(); this.afterCommand();
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
    for (const b of this.barEl.querySelectorAll<HTMLElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === 'docs'));
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
    syncUndoButtons(this.actionsBox ?? this.paletteEl, this.canvas.edits());
    this.syncClassLan();
    this.scheduleSave();
  }

  private syncClassLan(): void {
    const kinds = new Set([...this.topo.net.devices.values()].map((d) => d.kind));
    if (classLan.track(kinds.has(CLASSLAN_KIND))) this.topo.setKindContext(CLASSLAN_KIND, null); // the last one went: the host's link was given back
    syncOneOnlyButtons(this.toolButtons, kinds, () => this.selectTool({ kind: 'select' }, 'select'));
  }

  /** The Classroom LAN tool with a chooser: which class first (and join it); only then the tool is picked. */
  private async joinClassLan(tool: Tool, key: string): Promise<void> {
    const link = await classLan.join(askClass);
    if (link === 'cancel' || app !== this) return;
    if (link === null) { this.hintEl.textContent = t('classlan.joinFailed'); return; }
    this.topo.setKindContext(CLASSLAN_KIND, link);
    this.selectTool(tool, key);
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
    this.clockEl.textContent = formatToolbarClock(now.getTime(), getLocale());
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
    this.topo.setKindContext(CLASSLAN_KIND, null);
    this.topo = topo;
    topo.setKindContext(CLASSLAN_KIND, classLan.current);
    topo.clock.set(Date.now());
    this.saved.mark(topo);
    this.canvas.setTopology(topo);
    this.sim.attach(topo);
    this.mission.attach(topo);
    syncUndoButtons(this.actionsBox ?? this.paletteEl, this.canvas.edits());
    this.syncClassLan();
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

  /** `handle.open`: a file from the host's storage, after the same question as Import…. */
  async openHosted(topo: Topology, name: string): Promise<boolean> {
    if (!(await this.replaceAllowed('open'))) return false;
    this.load(topo, t('hint.opened', { name }));
    return true;
  }

  /** `handle.showView`: the host's menus open Netfix's pages (Help needs the classroom to allow it). */
  showHosted(view: unknown): boolean {
    const allowed: readonly View[] = ['net', 'docs', 'settings', 'about'];
    const v = allowed.find((x) => x === view);
    if (!v || (v === 'docs' && !this.session.policy.docs)) return false;
    this.showView(v);
    return true;
  }

  /** `handle.file`: the bar's Nuevo, Importar… or Exportar, if the restrictions allow it. */
  fileHosted(action: unknown): boolean {
    const p = this.session.policy;
    const run = { new: p.fileNew && this.barActions().newWorkspace, import: p.fileOpen && this.barActions().openFile, export: p.fileSave && this.barActions().save }[String(action)];
    if (!run) return false;
    run();
    return true;
  }

  /** `handle.markSaved`: the host stored the network. */
  markSaved(): void { this.saved.mark(this.topo); }

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
/** The host's Classroom LAN (Netfix Classroom), joined by every workspace this mount opens. */
// S23: the Classroom LAN is a registered kind (it moves to FixIT Classroom's pack in phase 2).
registerClassLanKind();
registerClassLanUi();
let classLan = new ClassLanState(null);
let mountEl: HTMLElement | null = null;
/** The host page's element for the top bar (`toolbar` option), or null: the bar is at the top of the mount. */
let barHost: HTMLElement | null = null;
/** The host page's element for the workspace's actions (`actions` option), or null. */
let actionsHost: HTMLElement | null = null;
let session: AppSession = STANDALONE;
/** Whether Netfix owns the page (its title, <html lang>, favicon): standalone on its own page, not embedded or a hosted lab. */
let onPage = true;

const ROOT_CLASS = 'netfix-root';
const BAR_CLASS = 'netfix-bar';
const ACTIONS_CLASS = 'netfix-actions';

/** Gives the host its toolbar element back empty, without Netfix's classes or language. */
function releaseBar(bar: HTMLElement): void {
  bar.replaceChildren();
  bar.classList.remove(ROOT_CLASS, BAR_CLASS, ACTIONS_CLASS);
  bar.removeAttribute('lang');
  if (bar.getAttribute('class') === '') bar.removeAttribute('class');
}

/** The language of the mount; mounted in a host, the page's title and <html lang> belong to the host. */
function applyLanguage(mount: HTMLElement): void {
  mount.lang = getLocale();
  if (barHost) barHost.lang = mount.lang;
  if (actionsHost) actionsHost.lang = mount.lang;
  if (onPage) applyDocumentLanguage();
}

/** Rebuilds the interface in another language, keeping the topology (open windows are closed). */
function changeLocale(locale: Locale): void {
  if (!session.embedded && !barHost) safeStorageSet(LOCALE_STORAGE_KEY, locale); // a host keeps its own choice
  if (!mountEl || !app) return;
  const topo = app.topo;
  const where = app.where();
  app.dispose();
  setLocale(locale);
  applyLanguage(mountEl);
  app = new App(mountEl, session, topo, where, barHost, actionsHost);
  app.announce(t('hint.language'));
}

/** Starts the interface in `mount` (one per page: a new start replaces the previous one). */
function start(mount: HTMLElement, s: AppSession, topo?: Topology, page = !s.embedded, host: HostOptions = NO_HOST): App {
  const bar = host.toolbar;
  app?.dispose();
  app = null;
  if (mountEl && mountEl !== mount) mountEl.replaceChildren();
  if (barHost && barHost !== bar) releaseBar(barHost);
  if (actionsHost && actionsHost !== host.actions) releaseBar(actionsHost);
  mountEl = mount;
  barHost = bar;
  actionsHost = host.actions;
  bar?.classList.add(ROOT_CLASS, BAR_CLASS); // the bar keeps Netfix's look (its rules hang off .netfix-root)
  host.actions?.classList.add(ROOT_CLASS, ACTIONS_CLASS);
  if (bar) mount.dataset.bar = 'host'; else delete mount.dataset.bar;
  if (bar && host.palette === 'bottom') mount.dataset.palette = 'bottom'; else delete mount.dataset.palette;
  session = s;
  onPage = page;
  MEMORY_STORE.clear();
  if (s.embedded) clearClipboard(); // each classroom mount starts with nothing copied from the one before
  setLocale(host.locale ?? detectLocale(s.embedded ? null : safeStorageGet(LOCALE_STORAGE_KEY), navigator.languages ?? [navigator.language]));
  overrideConfirmUnsaved(host.confirmUnsaved);
  overrideDevicePiles(host.piles);
  classLan = new ClassLanState(host.classroomLan);
  offerClassLan(classLan.offered);
  mount.classList.add(ROOT_CLASS);
  applyLanguage(mount);
  // Embedded, the page (and its theme) belongs to the host, and the classroom's restrictions decide what the missions offer.
  // With its bar in a host's menu, the host's theme (on <html>) is the one shown.
  if (!s.embedded) { if (!bar) applyTheme(); loadTimestampPrompt(); loadMissionsPref(); } else classroomMissions();
  applyBrand(mount, page);
  // The lock reaches every shell, also the ones opened over SSH from inside the simulation.
  forceTimestampPrompt(lockedPrompt(s.policy));
  app = new App(mount, s, topo, undefined, bar, host.actions);
  return app;
}

/** The page's whole interface; `ui/boot.ts` starts it on `#app` (importing this module has no effects, R7). */
export function startStandalone(mount: HTMLElement): App {
  return start(mount, STANDALONE);
}

/** The handle of a mount in a host element; `destroy` gives the host its element back as it was. */
function hosted(mount: HTMLElement, s: AppSession, topology: Topology | undefined, release: () => void, host: HostOptions): EmbedHandle {
  const bar = host.toolbar;
  let last = start(mount, s, topology, false, host);
  // A language change rebuilds the App with the same session: the handle follows the current one.
  const current = (): App | null => (session === s ? app : null);
  return {
    exportTopology: () => (last = current() ?? last).topo.toJSON(),
    open: async (file, name) => {
      const topo = Topology.fromJSON(file); // a bad file throws before anything is asked or replaced
      return current()?.openHosted(topo, String(name)) ?? false;
    },
    markSaved: () => current()?.markSaved(),
    showView: (view) => current()?.showHosted(view) ?? false,
    file: (action) => current()?.fileHosted(action) ?? false,
    setLocale: (locale) => {
      if (!isLocale(locale)) throw new Error('netfix: «locale» no es un idioma de Netfix');
      if (current() && locale !== getLocale()) changeLocale(locale);
    },
    setConfirmUnsaved: (on) => { if (current()) overrideConfirmUnsaved(on === true); },
    destroy: () => {
      const live = current();
      if (!live) return;
      last = live;
      live.dispose();
      app = null;
      forceTimestampPrompt(undefined);
      overrideConfirmUnsaved(undefined);
      overrideDevicePiles(undefined);
      clearClipboard();
      mount.replaceChildren();
      if (bar) releaseBar(bar);
      if (host.actions) releaseBar(host.actions);
      barHost = null;
      actionsHost = null;
      // No Netfix class, view, mode or language left on the element.
      mount.classList.remove(ROOT_CLASS);
      for (const k of ['view', 'mode', 'bar', 'palette'] as const) delete mount.dataset[k];
      mount.removeAttribute('lang');
      removeBrand(mount);
      for (const attr of ['class', 'style']) if (mount.getAttribute(attr) === '') mount.removeAttribute(attr);
      release();
    },
  };
}

/** What `ui/boot.ts` publishes as `globalThis.netfix`. */
export const NETFIX_API: NetfixApi = {
  embed: (mount, options): EmbedHandle => {
    checkMount(mount);
    const { rest, host } = takeHostOptions(mount, options);
    const { session: s, topology } = embedSession(rest);
    return hosted(mount, s, topology, () => undefined, host);
  },
  // The standalone lab (settings, theme, autosave, preferences) in a host's element; its theme needs <html data-theme>,
  // which destroy puts back. A fresh session object, so a handle never follows another mount's App.
  lab: (mount, options): EmbedHandle => {
    checkMount(mount);
    const host = labOptions(mount, options);
    const html = document.documentElement;
    const theme = html.dataset.theme;
    return hosted(mount, { ...STANDALONE }, undefined, () => {
      if (theme === undefined) delete html.dataset.theme;
      else html.dataset.theme = theme;
    }, host);
  },
  evaluate: evaluateFile,
  code: mountCode,
};
