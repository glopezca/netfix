/** Title and summary of a lab in the current language (catalogue keys lab.<id>.title / lab.<id>.summary). */
import type { Example } from '../net/examples.ts';
import { hasMessage, tDynamic } from '../i18n/t.ts';

export function labText(e: Pick<Example, 'id' | 'title' | 'summary'>): { title: string; summary: string } {
  const key = `lab.${e.id}`;
  return {
    title: hasMessage(`${key}.title`) ? tDynamic(`${key}.title`) : e.title,
    summary: hasMessage(`${key}.summary`) ? tDynamic(`${key}.summary`) : e.summary,
  };
}
