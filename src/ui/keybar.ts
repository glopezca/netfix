/**
 * Extra keys for touch screens (shown with CSS on coarse pointers): Esc, Tab, a sticky Ctrl, arrows,
 * ^C/^D and, for full-screen programs, F1–F10. Buttons never take the focus away from the terminal.
 */
import { el } from './dom.ts';
import { t } from '../i18n/t.ts';

export interface KeyTarget {
  virtualKey(key: string): void;
  ctrlArmed(): boolean;
}

const LINE_KEYS: readonly (readonly [string, string])[] = [
  ['Escape', 'Esc'], ['Tab', 'Tab'], ['Ctrl', 'Ctrl'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowLeft', '←'], ['ArrowRight', '→'], ['^C', '^C'], ['^D', '^D'],
];
const FN_KEYS: readonly string[] = Array.from({ length: 10 }, (_, i) => `F${i + 1}`);

export function keybar(target: KeyTarget): HTMLElement {
  const make = (key: string, label: string, fn = false): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: `term-key${fn ? ' term-fn' : ''}`, 'data-key': key, tabindex: '-1' }, label);
    // pointerdown + preventDefault keeps the virtual keyboard open and the focus where it was.
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      target.virtualKey(key);
      for (const c of bar.querySelectorAll('[data-key="Ctrl"]')) c.setAttribute('aria-pressed', String(target.ctrlArmed()));
    });
    return b;
  };
  const bar = el('div', { class: 'term-keys', role: 'toolbar', 'aria-label': t('term.keys') },
    ...LINE_KEYS.map(([k, l]) => make(k, l)), ...FN_KEYS.map((k) => make(k, k, true)));
  for (const c of bar.querySelectorAll('[data-key="Ctrl"]')) c.setAttribute('aria-pressed', 'false');
  return bar;
}
