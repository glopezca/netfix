/** A modal question with two answers (Cancel is focused, and Esc or a click outside also cancels). */
import { el } from './dom.ts';
import { button } from './forms.ts';
import { t } from '../i18n/t.ts';

export interface ConfirmText {
  readonly title: string;
  readonly body: string;
  readonly cancel: string;
  readonly proceed: string;
}

/** Resolves true only when the user picks the second answer. */
export function confirmDialog(text: ConfirmText): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'confirm-dialog', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body' });
    const close = (answer: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const cancel = button(text.cancel, () => close(false), 'btn');
    const proceed = button(text.proceed, () => close(true), 'btn danger');
    dialog.append(
      el('h2', { id: 'confirm-title', class: 'confirm-title' }, text.title),
      el('p', { id: 'confirm-body', class: 'confirm-body' }, text.body),
      el('div', { class: 'confirm-actions' }, cancel, proceed),
    );
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(false); });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

/** What would replace the network: a lab (by its title), a new empty network, or another file. */
export type Replacement = { readonly lab: string } | 'new' | 'open';

/** The question before something replaces changes that were not saved (the Save hint only when there is Save). */
export function unsavedText(what: Replacement, canSave: boolean): ConfirmText {
  const keep = canSave ? ` ${t('unsaved.keep')}` : '';
  const base = { title: t('unsaved.title'), cancel: t('unsaved.cancel') };
  if (what === 'new') return { ...base, body: t('unsaved.bodyNew') + keep, proceed: t('unsaved.proceedNew') };
  if (what === 'open') return { ...base, body: t('unsaved.bodyOpen') + keep, proceed: t('unsaved.proceedOpen') };
  return { ...base, body: t('unsaved.body', { lab: what.lab }) + keep, proceed: t('unsaved.proceed') };
}
