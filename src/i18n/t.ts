/** Translation and locale-aware formatting. */
import { getLocale } from './locale.ts';
import type { Locale } from './locale.ts';
import { CATALOGS } from './catalog.ts';
import type { MessageKey } from './catalog.ts';

export type Params = Readonly<Record<string, string | number>>;

/** Replaces {name} placeholders; unknown placeholders stay visible so a missing parameter is noticed. */
export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** The message `key` in the current language (or in `locale`). */
export function t(key: MessageKey, params?: Params, locale: Locale = getLocale()): string {
  return format(CATALOGS[locale][key], params);
}

/** Like t(), for keys built at run time (unknown keys return the key itself). */
export function tDynamic(key: string, params?: Params, locale: Locale = getLocale()): string {
  const table = CATALOGS[locale] as Readonly<Record<string, string>>;
  const msg = table[key];
  return msg === undefined ? key : format(msg, params);
}

export function hasMessage(key: string): key is MessageKey {
  return key in CATALOGS['es-ES'];
}

export function fmtNumber(n: number, opts: Intl.NumberFormatOptions = {}, locale: Locale = getLocale()): string {
  return new Intl.NumberFormat(locale, opts).format(n);
}

/** Money in euros, e.g. "5 €" / "€5". */
export function fmtEuros(amount: number, locale: Locale = getLocale()): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}

export function fmtDateTime(ms: number, locale: Locale = getLocale()): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(ms));
}
