/**
 * The missions' cast: the school whose tickets arrive ({school}) and its teacher who sends them ({teacher}). Standalone
 * Netfix keeps its own (mission.school, mission.<id>.teacher); a host such as FixIT Classroom sets the real ones with
 * setStoryNames. Every mission text, in the panel and in the help pages, goes through storyText.
 */
import { getLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { tDynamic } from '../i18n/t.ts';
import type { Params } from '../i18n/t.ts';

export interface StoryNames {
  readonly school?: string;
  readonly teacher?: string;
}

const NAME_MAX = 80;

let names: StoryNames = {};

/** A name from the host, as plain words: the help pages render mission texts as markdown. Empty: the default. */
function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[^\p{L}\p{M}\p{N} .,'’ºª()&/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : undefined;
}

/** The host's school and teacher for every mission (an empty object puts Netfix's own cast back). */
export function setStoryNames(n: StoryNames): void {
  const school = clean(n.school);
  const teacher = clean(n.teacher);
  names = { ...(school ? { school } : {}), ...(teacher ? { teacher } : {}) };
}

/** A mission text (or any other message) with {school} and {teacher} filled in, plus its own `params`. */
export function storyText(key: string, params?: Params, locale: Locale = getLocale()): string {
  const id = /^mission\.([^.]+)\./.exec(key)?.[1];
  const ownTeacher = id ? tDynamic(`mission.${id}.teacher`, undefined, locale) : '';
  const cast = {
    school: names.school ?? tDynamic('mission.school', undefined, locale),
    teacher: names.teacher ?? (ownTeacher.startsWith('mission.') ? '' : ownTeacher),
  };
  return tDynamic(key, { ...cast, ...params }, locale);
}
