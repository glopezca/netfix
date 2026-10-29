/**
 * Footer of the Linux and Windows terminals of a PC, Server or Linux router: «Prompt con marca de fecha y hora».
 * It is the global setting (also in Configuración → Generales): every terminal shows the same box; a classroom lock
 * fixes and greys it.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { setTimestampPromptPref, timestampPrompt } from './preferences.ts';

export interface PromptToggle {
  readonly root: HTMLElement;
  /** Shows the current value (it may have been changed from the other terminal of the device). */
  refresh(): void;
}

/** `locked`: the classroom forces the value (true/false). Changing it redraws every open terminal (preferences). */
export function promptToggle(locked: boolean | undefined): PromptToggle {
  const box = el('input', { type: 'checkbox', class: 'term-foot-box' });
  box.disabled = locked !== undefined;
  box.addEventListener('change', () => setTimestampPromptPref(box.checked));
  const label = el('label', { class: 'term-foot-check' }, box, el('span', {}, t('term.timestampPrompt')),
    locked === undefined ? null : el('span', { class: 'term-foot-lock' }, t('term.timestampLocked')));
  const refresh = (): void => { box.checked = timestampPrompt(); };
  refresh();
  return { root: el('div', { class: 'term-foot' }, label), refresh };
}
