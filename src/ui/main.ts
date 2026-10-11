/** netsim application shell: toolbar, workspace, palette, windows and simulation panel. */
import { el, staticSvg, safeStorageGet, safeStorageSet } from './dom.ts';
import { Canvas } from './canvas.ts';
import type { Tool } from './canvas.ts';
import { WindowManager } from './windows.ts';
import { SimPanel } from './simpanel.ts';
import { openDeviceWindow, forgetDevice, forgetAll } from './device-windows.ts';
import { ICONS, MODEL_LABEL } from './icons.ts';
import { Topology } from '../net/topology.ts';
import type { DeviceKind } from '../net/topology.ts';
import { EXAMPLES } from '../net/examples.ts';

const AUTOSAVE_KEY = 'netsim:workspace:v1';
const TICK_MS = 250;
const AUTOSAVE_DELAY_MS = 800;
const MINUTE = 60_000;

class App {
  topo: Topology;
  readonly canvas: Canvas;
  readonly windows: WindowManager;
  readonly sim: SimPanel;
  private readonly hintEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private saveTimer = 0;
  private mode: 'realtime' | 'simulation' = 'realtime';

  constructor(root: HTMLElement) {
    this.topo = this.initialTopology();
    this.hintEl = el('p', { class: 'hint', role: 'status' });
    this.clockEl = el('time', { class: 'clock' });
    this.canvas = new Canvas(this.topo, {
      open: (id) => this.open(id),
      changed: () => this.afterCommand(),
      hint: (t) => { this.hintEl.textContent = t; },
      removed: (id) => { this.windows.close(id); forgetDevice(id); },
    });
    const winLayer = el('div', { class: 'win-layer' });
    this.windows = new WindowManager(winLayer);
    this.sim = new SimPanel(this.topo, this.canvas);
    root.append(this.toolbar(), el('main', { class: 'stage' }, this.canvas.root, this.sim.root), this.palette(), winLayer);
    this.canvas.setTool({ kind: 'select' });
    this.canvas.render();
    window.setInterval(() => this.tick(), TICK_MS);
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      }
    });
    this.tick();
  }

  private initialTopology(): Topology {
    const saved = safeStorageGet(AUTOSAVE_KEY);
    if (saved) {
      try {
        return Topology.fromJSON(JSON.parse(saved));
      } catch {
        // A corrupt autosave falls back to the first example.
      }
    }
    return EXAMPLES[0]!.build();
  }

  // ------------------------------------------------------------ chrome

  private toolbar(): HTMLElement {
    const fileInput = el('input', { type: 'file', accept: '.json,.netsim,application/json', hidden: true });
    fileInput.addEventListener('change', () => void this.openFile(fileInput));
    const btn = (label: string, fn: () => void, attrs: Record<string, string> = {}): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: 'btn', ...attrs }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const examples = el('select', { class: 'select', 'aria-label': 'Abrir un laboratorio de ejemplo' },
      el('option', { value: '' }, 'Laboratorios…'), ...EXAMPLES.map((e) => el('option', { value: e.id }, e.title)));
    examples.addEventListener('change', () => {
      const ex = EXAMPLES.find((e) => e.id === examples.value);
      examples.value = '';
      if (ex) this.load(ex.build(), ex.summary);
    });
    const advance = el('select', { class: 'select', 'aria-label': 'Avanzar el reloj de la simulación' },
      el('option', { value: '' }, 'Avanzar reloj…'),
      el('option', { value: String(MINUTE) }, '+1 minuto'), el('option', { value: String(60 * MINUTE) }, '+1 hora'),
      el('option', { value: String(24 * 60 * MINUTE) }, '+1 día'));
    advance.addEventListener('change', () => {
      const ms = Number(advance.value);
      advance.value = '';
      if (ms > 0) this.advance(ms);
    });
    const modeRT = el('button', { type: 'button', class: 'seg', 'aria-pressed': 'true' }, 'Tiempo real');
    const modeSim = el('button', { type: 'button', class: 'seg', 'aria-pressed': 'false' }, 'Simulación');
    const setMode = (m: 'realtime' | 'simulation'): void => {
      this.mode = m;
      modeRT.setAttribute('aria-pressed', String(m === 'realtime'));
      modeSim.setAttribute('aria-pressed', String(m === 'simulation'));
      this.sim.setActive(m === 'simulation');
      document.body.dataset.mode = m;
      this.hintEl.textContent = m === 'simulation'
        ? 'Simulación: lo que hagas (ipconfig /renew, ping, DHCP) queda en la lista de eventos. Pulsa Reproducir.'
        : 'Tiempo real: la red funciona sola; los cambios se aplican al instante.';
    };
    modeRT.addEventListener('click', () => setMode('realtime'));
    modeSim.addEventListener('click', () => setMode('simulation'));
    return el('header', { class: 'topbar' },
      el('h1', { class: 'brand' }, 'netsim'),
      el('nav', { class: 'file-actions', 'aria-label': 'Archivo' },
        btn('Nuevo', () => this.load(new Topology(), 'Área de trabajo vacía.')),
        btn('Abrir…', () => fileInput.click()),
        btn('Guardar', () => void this.save(), { title: 'Guardar la topología en un archivo .json (Ctrl+S)' }),
        examples, fileInput),
      el('div', { class: 'time' }, this.clockEl, advance),
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'Modo' }, modeRT, modeSim));
  }

  private palette(): HTMLElement {
    const deviceBtn = (kind: DeviceKind, name: string): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: 'pal-item', 'aria-pressed': 'false' },
        staticSvg(ICONS[kind]), el('span', { class: 'pal-name' }, name), el('span', { class: 'pal-model' }, MODEL_LABEL[kind]));
      b.addEventListener('click', () => this.selectTool({ kind: 'place', device: kind }, `place-${kind}`));
      this.toolButtons.set(`place-${kind}`, b);
      return b;
    };
    const toolBtn = (key: string, name: string, tool: Tool, glyph: string): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: `pal-item pal-tool pal-${key}`, 'aria-pressed': 'false' },
        el('span', { class: 'pal-glyph', 'aria-hidden': 'true' }, glyph), el('span', { class: 'pal-name' }, name));
      b.addEventListener('click', () => this.selectTool(tool, key));
      this.toolButtons.set(key, b);
      return b;
    };
    return el('footer', { class: 'palette' },
      el('div', { class: 'pal-group', role: 'group', 'aria-label': 'Dispositivos' },
        deviceBtn('router', 'Router'), deviceBtn('switch', 'Switch'), deviceBtn('pc', 'PC'), deviceBtn('server', 'Servidor')),
      el('div', { class: 'pal-group', role: 'group', 'aria-label': 'Herramientas' },
        toolBtn('select', 'Seleccionar', { kind: 'select' }, '↖'),
        toolBtn('cable', 'Cable', { kind: 'cable' }, '⌇'),
        toolBtn('delete', 'Eliminar', { kind: 'delete' }, '✕')),
      this.hintEl);
  }

  private selectTool(tool: Tool, key: string): void {
    const same = this.toolButtons.get(key)?.getAttribute('aria-pressed') === 'true' && key !== 'select';
    const next: Tool = same ? { kind: 'select' } : tool;
    const nextKey = same ? 'select' : key;
    for (const [k, b] of this.toolButtons) b.setAttribute('aria-pressed', String(k === nextKey));
    this.canvas.setTool(next);
    this.canvas.root.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ behaviour

  private open(id: string): void {
    const placed = this.topo.get(id);
    if (placed) openDeviceWindow(placed, this);
  }

  afterCommand(): void {
    this.topo.net.runFor(20);
    this.canvas.render();
    this.scheduleSave();
  }

  private tick(): void {
    if (this.mode === 'realtime' || this.topo.net.pending() > 0) this.topo.net.runFor(TICK_MS);
    const now = new Date(this.topo.clock.now());
    this.clockEl.textContent = `${now.toISOString().slice(11, 19)} UTC`;
    this.clockEl.setAttribute('datetime', now.toISOString());
    this.canvas.requestRender();
  }

  private advance(ms: number): void {
    this.topo.net.runFor(ms);
    this.hintEl.textContent = 'Reloj adelantado: las concesiones se renuevan o caducan como en un equipo real.';
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
    this.saveTimer = window.setTimeout(() => safeStorageSet(AUTOSAVE_KEY, JSON.stringify(this.topo.toJSON())), AUTOSAVE_DELAY_MS);
  }

  /** Saves the topology as .json: file picker when the browser has one, download otherwise. */
  private async save(): Promise<void> {
    const json = JSON.stringify(this.topo.toJSON(), null, 2);
    if (document.getElementById('app')?.dataset.embed === 'artifact') {
      navigator.clipboard?.writeText(json).then(
        () => { this.hintEl.textContent = 'Topología copiada al portapapeles: pégala en un archivo .json para guardarla.'; },
        () => { this.hintEl.textContent = 'No se pudo copiar. Usa la versión descargable de netsim para guardar archivos.'; },
      );
      return;
    }
    const name = `topologia-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.netsim.json`;
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({ suggestedName: name, types: [{ description: 'Topología de netsim', accept: { 'application/json': ['.json'] } }] });
        const w = await handle.createWritable();
        await w.write(json);
        await w.close();
        this.hintEl.textContent = 'Topología guardada.';
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.hintEl.textContent = `Descargado ${name}. Ábrelo luego con Abrir….`;
  }

  private async openFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const topo = Topology.fromJSON(JSON.parse(await file.text()));
      this.load(topo, `Abierto ${file.name}.`);
    } catch (err) {
      this.hintEl.textContent = `No se pudo abrir ${file.name}: ${err instanceof Error ? err.message : 'formato desconocido'}`;
    }
  }
}

const mount = document.getElementById('app');
if (mount) new App(mount);
