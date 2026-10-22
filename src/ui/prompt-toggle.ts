/**
 * Footer of the Linux and Windows terminals of a PC, Server or Linux router: «Prompt con marca de fecha y hora».
 * It is a device setting, so the two terminals of the device show the same box; a classroom lock fixes and greys it.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import type { Host } from '../devices/host.ts';
import { setTimestampPrompt, timestampPromptOn } from '../shells/prompt-clock.ts';

export interface PromptToggle {
  readonly root: HTMLElement;
  /** Shows the current value (it may have been changed from the other terminal of the device). */
  refresh(): void;
}

/** `locked`: the classroom forces the value (true/false); `changed`: the device setting changed, redraw the prompts. */
export function promptToggle(host: Host, locked: boolean | undefined, changed: () => void): PromptToggle {
  const box = el('input', { type: 'checkbox', class: 'term-foot-box' });
  box.disabled = locked !== undefined;
  box.addEventListener('change', () => {
    setTimestampPrompt(host, box.checked);
    changed();
  });
  const label = el('label', { class: 'term-foot-check' }, box, el('span', {}, t('term.timestampPrompt')),
    locked === undefined ? null : el('span', { class: 'term-foot-lock' }, t('term.timestampLocked')));
  const refresh = (): void => { box.checked = timestampPromptOn(host); };
  refresh();
  return { root: el('div', { class: 'term-foot' }, label), refresh };
}
