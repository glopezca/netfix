/**
 * HTML built as data: every text and attribute value is escaped when rendered, so pages made from
 * configuration or user input (mail, host names, files) cannot inject markup.
 */
import { getLocale, localeFromAcceptLanguage } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';

export interface Markup {
  readonly html: string;
}

export type Child = Markup | string | number | null | undefined | false | readonly Child[];

const VOID = new Set(['br', 'hr', 'input', 'meta', 'img', 'link']);

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function render(c: Child): string {
  if (c === null || c === undefined || c === false) return '';
  if (typeof c === 'string') return escapeHtml(c);
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(render).join('');
  return (c as Markup).html;
}

/** An element; attributes with false/undefined values are left out, true renders a bare attribute. */
export function h(tag: string, attrs: Readonly<Record<string, string | number | boolean | undefined>> = {}, ...children: Child[]): Markup {
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error(`bad tag ${tag}`);
  const a = Object.entries(attrs)
    .filter(([k, v]) => v !== undefined && v !== false && /^[a-z][a-z0-9-]*$/.test(k))
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(String(v))}"`)).join('');
  return { html: VOID.has(tag) ? `<${tag}${a}>` : `<${tag}${a}>${render(children)}</${tag}>` };
}

export function fragment(...children: Child[]): Markup {
  return { html: render(children) };
}

/** Language of a request: its Accept-Language, Spanish when absent or unsupported. */
export function requestLocale(req: { readonly headers?: Readonly<Record<string, string>> }): Locale {
  return localeFromAcceptLanguage(req.headers?.['accept-language']) ?? 'es-ES';
}

/** A whole document. */
export function page(title: string, bodyClass: string, ...children: Child[]): string {
  return `<!doctype html>\n<html lang="${getLocale().slice(0, 2)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>\n${h('body', { class: bodyClass }, ...children).html}\n</html>\n`;
}
