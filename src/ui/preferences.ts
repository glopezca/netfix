/** General settings of this browser (Configuración → Generales): theme, the unsaved-changes question, language of the page. */
import { safeStorageGet, safeStorageSet } from './dom.ts';
import { getLocale } from '../i18n/locale.ts';
import { t } from '../i18n/t.ts';
import { setGlobalTimestampPrompt, timestampPromptOn } from '../shells/prompt-clock.ts';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = 'netfix:theme';
const CONFIRM_KEY = 'netfix:confirm-unsaved';
const STAMP_KEY = 'netfix:timestamp-prompt';
const stampListeners = new Set<() => void>();
/** Saved only outside the classroom (embedded pages leave the host page's storage alone). */
let stampStored = false;

export function theme(): Theme {
  const v = safeStorageGet(THEME_KEY);
  return THEMES.find((x) => x === v) ?? 'auto';
}

/** The CSS reads `data-theme` (light or dark); without it, the system's choice. */
export function applyTheme(value: Theme = theme()): void {
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
}

export function setTheme(value: Theme): void {
  safeStorageSet(THEME_KEY, value);
  applyTheme(value);
}

/** Ask before a lab, Nuevo or Abrir replaces unsaved changes (on unless turned off). */
export function confirmUnsaved(): boolean {
  return safeStorageGet(CONFIRM_KEY) !== 'off';
}

export function setConfirmUnsaved(on: boolean): void {
  safeStorageSet(CONFIRM_KEY, on ? 'on' : 'off');
}

/** The page's language, title and description in the current language. */
export function applyDocumentLanguage(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}

/** «Prompt con marca de fecha y hora» for every terminal: off unless turned on (a classroom lock still wins). */
export function loadTimestampPrompt(): void {
  stampStored = true;
  setGlobalTimestampPrompt(safeStorageGet(STAMP_KEY) === 'on');
}

/** The value the terminals show now (the classroom lock included). */
export function timestampPrompt(): boolean {
  return timestampPromptOn();
}

export function setTimestampPromptPref(on: boolean): void {
  if (stampStored) safeStorageSet(STAMP_KEY, on ? 'on' : 'off');
  setGlobalTimestampPrompt(on);
  for (const fn of stampListeners) fn();
}

/** The open terminals redraw their prompts when the setting changes (from Configuración or from any terminal). */
export function onTimestampPrompt(fn: () => void): void {
  stampListeners.add(fn);
}
