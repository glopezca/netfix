/**
 * Midnight Commander's own texts: its msgids (English) and, when Netfix is in Spanish, the Spanish translation that
 * ships with mc 4.8 (mc-es.ts, from its es.po). As mc's gettext: `mcT` is _(), `mcQ` is Q_() for "Context|text".
 */
import { getLocale } from '../i18n/locale.ts';
import { MC_ES } from './mc-es.ts';

export function mcT(msgid: string): string {
  return getLocale() === 'es-ES' ? MC_ES[msgid] ?? msgid : msgid;
}

/** A msgid with a context ("ButtonBar|Copy"): its translation, else the text after the bar. */
export function mcQ(msgid: string): string {
  const s = mcT(msgid);
  return s === msgid ? msgid.slice(msgid.indexOf('|') + 1) : s;
}

/** A label with its hotkey marked by & ("crear &Directorio..."): the text and the hotkey's index (-1: none). */
export function hotLabel(label: string): { readonly text: string; readonly hot: number } {
  const at = label.indexOf('&');
  return at < 0 ? { text: label, hot: -1 } : { text: label.slice(0, at) + label.slice(at + 1), hot: at };
}

/** mc's %s / %d placeholders, in order. */
export function mcFormat(template: string, ...args: readonly (string | number)[]): string {
  let i = 0;
  return template.replace(/%[sd]/g, () => String(args[i++] ?? ''));
}
