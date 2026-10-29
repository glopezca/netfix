/** Floating device windows: draggable, stackable, with tabs (like Packet Tracer). */
import { el } from './dom.ts';
import { t } from '../i18n/t.ts';

export interface Tab {
  readonly id: string;
  readonly label: string;
  readonly render: () => HTMLElement;
  readonly onShow?: () => void;
}

export interface WindowHandle {
  readonly root: HTMLElement;
  setTitle(text: string): void;
  close(): void;
  focus(): void;
}

export class WindowManager {
  private readonly layer: HTMLElement;
  private readonly open = new Map<string, WindowHandle & { cleanup: () => void }>();
  private z = 10;
  private cascade = 0;
  /** Keys from the bottom to the top of the stack. */
  private order: string[] = [];

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  has(key: string): boolean {
    return this.open.has(key);
  }

  focus(key: string): void {
    this.open.get(key)?.focus();
  }

  closeAll(): void {
    for (const w of [...this.open.values()]) w.close();
  }

  /** Brings the window at the bottom of the stack to the top (full-screen sheets on phones). */
  private cycle(): void {
    const bottom = this.order[0];
    if (bottom !== undefined && this.order.length > 1) this.open.get(bottom)?.focus();
  }

  private focusTop(): void {
    const top = this.order[this.order.length - 1];
    if (top !== undefined) this.open.get(top)?.root.querySelector<HTMLElement>('.win-tab[aria-selected="true"], .win-close')?.focus({ preventScroll: true });
  }

  private updateCounts(): void {
    const n = this.open.size;
    for (const w of this.open.values()) {
      const b = w.root.querySelector<HTMLButtonElement>('.win-next');
      if (!b) continue;
      b.hidden = n < 2;
      b.setAttribute('aria-label', t('win.next', { count: n }));
      b.title = t('win.next', { count: n });
    }
  }

  /** The window element of a key (to reopen it in the same place). */
  element(key: string): HTMLElement | undefined {
    return this.open.get(key)?.root;
  }

  close(key: string): void {
    this.open.get(key)?.close();
  }

  /** `initial`: the tab shown first; `like`: a window this one replaces, whose place and size it keeps. */
  show(key: string, title: string, tabs: readonly Tab[], onClose: () => void = () => undefined, opts: { initial?: string; like?: HTMLElement } = {}): WindowHandle {
    const existing = this.open.get(key);
    if (existing) {
      existing.focus();
      return existing;
    }
    const titleEl = el('h2', { class: 'win-title', id: `wt-${key}` }, title);
    const closeBtn = el('button', { class: 'win-close', type: 'button', 'aria-label': t('win.close', { title }) }, '×');
    const maxBtn = el('button', { class: 'win-btn win-max', type: 'button', 'aria-label': t('win.maximize'), title: t('win.maximize'), 'aria-pressed': 'false' }, '□');
    const nextBtn = el('button', { class: 'win-btn win-next', type: 'button' }, '⧉');
    const header = el('header', { class: 'win-head' }, titleEl, el('div', { class: 'win-actions' }, nextBtn, maxBtn, closeBtn));
    const tabBar = el('div', { class: 'win-tabs', role: 'tablist' });
    const body = el('div', { class: 'win-body' });
    const root = el('section', { class: 'window', role: 'dialog', 'aria-labelledby': `wt-${key}` }, header, tabBar, body);
    if (opts.like) root.style.cssText = opts.like.style.cssText;
    else place(root, (this.cascade++ % 6) * 28);
    const select = tabStrip(tabs, tabBar, body);
    tabBar.hidden = tabs.length < 2;
    const handle = {
      root,
      setTitle: (text: string) => { titleEl.textContent = text; },
      focus: () => {
        root.style.zIndex = String(++this.z);
        this.order = [...this.order.filter((k) => k !== key), key];
        this.updateCounts();
      },
      close: () => {
        root.remove();
        this.open.delete(key);
        this.order = this.order.filter((k) => k !== key);
        this.updateCounts();
        this.focusTop();
        onClose();
      },
      cleanup: onClose,
    };
    closeBtn.addEventListener('click', handle.close);
    maxBtn.addEventListener('click', () => toggleMax(root, maxBtn));
    nextBtn.addEventListener('click', () => this.cycle());
    root.addEventListener('pointerdown', handle.focus);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) handle.close(); });
    makeDraggable(root, header);
    this.layer.appendChild(root);
    this.open.set(key, handle);
    handle.focus();
    const first = tabs.find((tab) => tab.id === opts.initial) ?? tabs[0];
    if (first) select(first);
    return handle;
  }
}

/** First position of a window: fully inside the viewport and below the real top bar. */
function place(root: HTMLElement, offset: number): void {
  // The default width is min(880px, 100vw - 16px).
  const width = Math.min(880, window.innerWidth - 16);
  root.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, 120 + offset))}px`;
  // The top bar wraps to two rows on medium widths (and collapses into a menu on phones).
  const barBottom = Math.ceil(document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 56);
  const top = barBottom + 12 + offset;
  root.style.top = `${top}px`;
  root.style.maxHeight = `calc(100dvh - ${top + 8}px)`;
}

/** Tab buttons of a window; each tab is drawn the first time it is shown and then kept. */
function tabStrip(tabs: readonly Tab[], tabBar: HTMLElement, body: HTMLElement): (tab: Tab) => void {
  const rendered = new Map<string, HTMLElement>();
  const buttons = tabs.map((tab) => {
    const b = el('button', { class: 'win-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }, tab.label);
    b.addEventListener('click', () => select(tab));
    tabBar.appendChild(b);
    return b;
  });
  const select = (tab: Tab): void => {
    tabs.forEach((x, i) => buttons[i]?.setAttribute('aria-selected', String(x === tab)));
    let view = rendered.get(tab.id);
    if (!view) {
      view = tab.render();
      rendered.set(tab.id, view);
      body.appendChild(view);
    }
    for (const v of rendered.values()) v.hidden = v !== view;
    tab.onShow?.();
  };
  return select;
}

function toggleMax(root: HTMLElement, maxBtn: HTMLElement): void {
  const on = root.dataset.max !== 'true';
  root.dataset.max = String(on);
  maxBtn.setAttribute('aria-pressed', String(on));
  maxBtn.setAttribute('aria-label', t(on ? 'win.restore' : 'win.maximize'));
  maxBtn.title = t(on ? 'win.restore' : 'win.maximize');
}

function makeDraggable(win: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const startX = e.clientX - win.offsetLeft;
    const startY = e.clientY - win.offsetTop;
    handle.setPointerCapture(e.pointerId);
    if (win.dataset.max === 'true' || window.matchMedia('(max-width: 760px)').matches) return;
    const move = (ev: PointerEvent): void => {
      win.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - startX))}px`;
      win.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - startY))}px`;
    };
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
