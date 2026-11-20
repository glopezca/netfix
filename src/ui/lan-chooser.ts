/**
 * The Classroom LAN of a mount (host option `classroomLan`): the host's link, or a chooser that asks which class when
 * the device is about to be placed. Deleting the lab's last LAN device gives the link back (its close()), so a chooser
 * asks again next time.
 */
import { isLanChooser, validLab, type ClassLanChooser, type ClassLanClass, type ClassLanLink } from '../net/classlan.ts';
import type { KindHost } from './host-options.ts';
import { el, uiRoot } from './dom.ts';
import { button } from './forms.ts';
import { t } from '../i18n/t.ts';

export type AskClass = (classes: readonly ClassLanClass[]) => Promise<string | null>;

export class ClassLanState {
  private readonly host: ClassLanLink | ClassLanChooser | null;
  private link: ClassLanLink | null;
  private present = false;

  constructor(host: ClassLanLink | ClassLanChooser | null) {
    this.host = host;
    this.link = host && !isLanChooser(host) ? host : null;
  }

  /** The link the devices use now (null: none, or not joined yet). */
  get current(): ClassLanLink | null { return this.link; }

  /** Whether the palette offers the device at all. */
  get offered(): boolean { return this.host !== null; }

  /** Placing the device needs a join first (a chooser not joined yet, or a link already given back). */
  get needsJoin(): boolean { return this.host !== null && this.link === null; }

  /** Before placing: the link joined, 'cancel' (the person said no) or null (refused, unreachable, or left for good). */
  async join(ask: AskClass): Promise<ClassLanLink | 'cancel' | null> {
    if (this.link || !this.host || !isLanChooser(this.host)) return this.link;
    const { classes } = this.host;
    const id = classes.length === 1 ? classes[0]!.id : await ask(classes);
    if (id === null) return 'cancel';
    try {
      this.link = await this.host.join(id);
    } catch {
      this.link = null;
    }
    return this.link;
  }

  /** After every change: true when the lab's last LAN device just went (the link was given back). */
  track(present: boolean): boolean {
    if (present || !this.present) {
      this.present = present;
      return false;
    }
    this.present = false;
    const gone = this.link;
    if (!gone?.close && !(this.host && isLanChooser(this.host))) return false; // a plain link without close() stays
    this.link = null;
    gone?.close?.();
    return true;
  }
}

/** «Which class does this LAN belong to?»: a radio list of the classes; resolves the id, or null on Cancel/Esc. */
export function askClass(classes: readonly ClassLanClass[]): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'confirm-dialog lan-chooser', 'aria-labelledby': 'lan-chooser-title' });
    const done = (id: string | null): void => { dialog.close(); dialog.remove(); resolve(id); };
    const radios = classes.map((c, i) => {
      const input = el('input', { type: 'radio', name: 'lan-class', value: c.id });
      input.checked = i === 0;
      return el('label', { class: 'lan-class' }, input, ' ', c.name);
    });
    const ok = button(t('classlan.choose'), () => done(dialog.querySelector<HTMLInputElement>('input[name="lan-class"]:checked')?.value ?? null), 'btn primary');
    dialog.append(
      el('h2', { id: 'lan-chooser-title', class: 'confirm-title' }, t('classlan.which')),
      el('div', { class: 'lan-classes', role: 'radiogroup' }, ...radios),
      el('div', { class: 'confirm-actions' }, button(t('unsaved.cancel'), () => done(null), 'btn'), ok),
    );
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    uiRoot().appendChild(dialog);
    dialog.showModal();
    radios[0]?.querySelector('input')?.focus();
  });
}

const MAX_LAN_NAME = 64;
const MAX_LAN_CLASSES = 50;
const MAX_CLASS_NAME = 80;
const LAN_SHAPE = 'netfix: «classroomLan» necesita lab (1-250), send() y onMessage() (y close() opcional), o classes (1-50, {id, name}) y join(id)';

/** The host's Classroom LAN link: its lab number (1-250), its two functions and, optionally, the class's name and close(). */
function linkOf(v: unknown): ClassLanLink {
  const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
  if (!validLab(o.lab) || typeof o.send !== 'function' || typeof o.onMessage !== 'function' || (o.close !== undefined && typeof o.close !== 'function')) throw new Error(LAN_SHAPE);
  const send = o.send as ClassLanLink['send'];
  const onMessage = o.onMessage as ClassLanLink['onMessage'];
  const close = o.close as (() => void) | undefined;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_LAN_NAME) : '';
  return { lab: o.lab, ...(name ? { name } : {}), send: (m) => send(m), onMessage: (l) => onMessage(l), ...(close ? { close: () => close() } : {}) };
}

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** The host's classes to ask about: 1-50 with an id and a name; `join` resolves a link checked like a plain one (or null). */
function chooserOf(o: Record<string, unknown>): ClassLanChooser {
  const list = o.classes;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_LAN_CLASSES || typeof o.join !== 'function') throw new Error(LAN_SHAPE);
  const classes: ClassLanClass[] = list.map((c: unknown) => {
    const { id, name } = typeof c === 'object' && c !== null ? c as Record<string, unknown> : {};
    if (!text(id, MAX_CLASS_NAME) || !text(name, MAX_CLASS_NAME)) throw new Error(LAN_SHAPE);
    return { id, name: name.trim() };
  });
  const join = o.join as (id: string) => Promise<unknown>;
  return {
    classes,
    join: async (id) => {
      const got = await join(id);
      return got === null ? null : linkOf(got); // a malformed link fails here, like the plain option
    },
  };
}

/** The host option `classroomLan` (untrusted: checked, errors thrown). */
export function parseClassLan(v: unknown): ClassLanLink | ClassLanChooser {
  return typeof v === 'object' && v !== null && 'classes' in v ? chooserOf(v as Record<string, unknown>) : linkOf(v);
}

/** A mount's Classroom LAN as a kind host (ui/host-options.ts): joins before the tool is picked, gives the link back. */
export function classLanHost(value: ClassLanLink | ClassLanChooser | null, ask: AskClass = askClass): KindHost {
  const state = new ClassLanState(value);
  return {
    offered: state.offered,
    get context() { return state.current; },
    prepare: async () => {
      if (!state.needsJoin) return true;
      const link = await state.join(ask);
      return link === 'cancel' ? false : link === null ? t('classlan.joinFailed') : true;
    },
    track: (present) => state.track(present),
  };
}
