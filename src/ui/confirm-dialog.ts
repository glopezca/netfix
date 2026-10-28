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

/** The question before a lab replaces changes that were not saved. */
export function unsavedLabText(lab: string): ConfirmText {
  return { title: t('unsaved.title'), body: t('unsaved.body', { lab }), cancel: t('unsaved.cancel'), proceed: t('unsaved.proceed') };
}
