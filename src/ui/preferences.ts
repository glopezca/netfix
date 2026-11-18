/** General settings of this browser (Configuración → Generales): theme, the unsaved-changes question, the missions, language of the page. */
import { safeStorageGet, safeStorageSet } from './dom.ts';
import { getLocale } from '../i18n/locale.ts';
import { t } from '../i18n/t.ts';
import { setGlobalTimestampPrompt, timestampPromptOn } from '../shells/prompt-clock.ts';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = 'netfix:theme';
const CONFIRM_KEY = 'netfix:confirm-unsaved';
const STAMP_KEY = 'netfix:timestamp-prompt';
const TOOL_HELP_KEY = 'netfix:tool-help';

/** With the bar in a host's menu, each tool's help («Arrastra para mover…») shows in a note that can be turned off. */
export function toolHelp(): boolean {
  return safeStorageGet(TOOL_HELP_KEY) !== 'off';
}

export function setToolHelp(on: boolean): void {
  safeStorageSet(TOOL_HELP_KEY, on ? 'on' : 'off');
}
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
/** Set by a host page that owns this preference (`confirmUnsaved` option); undefined: this browser's setting. */
let confirmOverride: boolean | undefined;
export function overrideConfirmUnsaved(on: boolean | undefined): void { confirmOverride = on; }

export function confirmUnsaved(): boolean {
  return confirmOverride ?? safeStorageGet(CONFIRM_KEY) !== 'off';
}

export function setConfirmUnsaved(on: boolean): void {
  safeStorageSet(CONFIRM_KEY, on ? 'on' : 'off');
}

/** Similar devices piled on one palette button (Router: IOS or GNU/Linux; PC: Windows, GNU/Linux or both); off unless turned on. */
const PILES_KEY = 'netfix:device-piles';
/** Set by a host page (`piles` option); undefined: this browser's setting. */
let pilesOverride: boolean | undefined;
const pilesListeners = new Set<() => void>();
export function overrideDevicePiles(on: boolean | undefined): void { pilesOverride = on; }
export function devicePiles(): boolean {
  return pilesOverride ?? safeStorageGet(PILES_KEY) === 'on';
}
/** The settings box: kept in this browser and, for the session, over the host's choice; the palette redraws. */
export function setDevicePiles(on: boolean): void {
  safeStorageSet(PILES_KEY, on ? 'on' : 'off');
  if (pilesOverride !== undefined) pilesOverride = on;
  for (const l of pilesListeners) l();
}
export function onDevicePiles(listener: () => void): () => void {
  pilesListeners.add(listener);
  return () => pilesListeners.delete(listener);
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

const MISSIONS_KEY = 'netfix:missions';
const missionListeners = new Set<() => void>();
let missionsOn = false;
/** Saved only outside the classroom, as the prompt option. */
let missionsStored = false;

/** «Mostrar las misiones de los laboratorios»: off unless turned on in this browser. */
export function loadMissionsPref(): void {
  missionsStored = true;
  missionsOn = safeStorageGet(MISSIONS_KEY) === 'on';
}

/** Whether the mission panel and the Laboratorios group of the Help tab show. */
export function missionsShown(): boolean {
  return missionsOn;
}

export function setMissionsShown(on: boolean): void {
  if (missionsStored) safeStorageSet(MISSIONS_KEY, on ? 'on' : 'off');
  missionsOn = on;
  for (const fn of missionListeners) fn();
}

/** In the classroom (embedded) missions always show, and the host page's storage is left alone. */
export function classroomMissions(): void {
  missionsStored = false;
  missionsOn = true;
}

/** The mission panel and the Help tab redraw when the option changes; the result stops listening. */
export function onMissionsShown(fn: () => void): () => void {
  missionListeners.add(fn);
  return () => { missionListeners.delete(fn); };
}
