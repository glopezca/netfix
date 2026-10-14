/**
 * Current language of Netfix (presentation state). A leaf module: it imports nothing from src/, so any layer
 * can ask for the locale without import cycles. Program output (IOS, bash, cmd) never
 * depends on it; only the built-in manuals (man, help) follow it, because they are Netfix's documentation.
 */

export type Locale = 'es-ES' | 'en-GB';

export const LOCALES: readonly Locale[] = ['es-ES', 'en-GB'];
export const DEFAULT_LOCALE: Locale = 'es-ES';
export const LOCALE_STORAGE_KEY = 'netfix:locale';

/** Name of each language in its own language (for the selector). */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { 'es-ES': 'Español (España)', 'en-GB': 'English (UK)' };
/** Short label for compact selectors. */
export const LOCALE_SHORT: Readonly<Record<Locale, string>> = { 'es-ES': 'ES', 'en-GB': 'EN' };

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(l: Locale) => void>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Language of the page being rendered by a simulated web server (set only while it renders). */
let rendering: Locale | null = null;

export function getLocale(): Locale {
  return rendering ?? current;
}

/**
 * Runs `fn` with another language (a simulated server answering in the visitor's Accept-Language);
 * rendering is synchronous, so the previous language is always restored.
 */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  const before = rendering;
  rendering = locale;
  try {
    return fn();
  } finally {
    rendering = before;
  }
}

/** Changes the language and notifies the listeners (only when it really changes). */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const fn of [...listeners]) fn(locale);
}

/** Subscribes to language changes; returns the function that unsubscribes. */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The saved choice, else the first browser language we have (es-* → es-ES, en-* → en-GB), else Spanish. */
export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'es') return 'es-ES';
    if (base === 'en') return 'en-GB';
  }
  return DEFAULT_LOCALE;
}

/** Locale for an HTTP Accept-Language header (simulated web servers); null when it names neither language. */
export function localeFromAcceptLanguage(header: string | undefined): Locale | null {
  if (!header) return null;
  const ranked = header.split(',').map((part, i) => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find((v) => v !== undefined);
    return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), i };
  }).filter((x) => x.tag && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'es') return 'es-ES';
    if (base === 'en') return 'en-GB';
  }
  return null;
}
