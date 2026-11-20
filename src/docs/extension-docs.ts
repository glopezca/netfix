/**
 * Manual pages of programs that extensions add (shells/programs.ts), kept here so that docs never imports the shells.
 * `utilDocs` lists them after the core's own; they are grouped with the editors.
 */
import type { Locale } from '../i18n/locale.ts';
import type { UtilDoc } from './utils.ts';

export interface ExtensionDoc {
  readonly synopsis: string;
  readonly summary: string;
  readonly options?: string;
}

const pages = new Map<string, Readonly<Record<Locale, ExtensionDoc>>>();

export function registerExtensionDocs(name: string, docs: Readonly<Record<Locale, ExtensionDoc>>): void {
  pages.set(name, docs);
}

/** The pages in one language, as the core's (man section 1). */
export function extensionUtilDocs(locale: Locale): Record<string, UtilDoc> {
  const out: Record<string, UtilDoc> = {};
  for (const [name, d] of pages) out[name] = { ...d[locale], section: 1, group: 'editores' };
  return out;
}
