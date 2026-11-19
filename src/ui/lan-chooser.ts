/**
 * The Classroom LAN of a mount (host option `classroomLan`): the host's link, or a chooser that asks which class when
 * the device is about to be placed. Deleting the lab's last LAN device gives the link back (its close()), so a chooser
 * asks again next time.
 */
import { isLanChooser, type ClassLanChooser, type ClassLanClass, type ClassLanLink } from '../net/classlan.ts';
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
