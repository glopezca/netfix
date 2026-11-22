/**
 * The missions' cast: the school whose tickets arrive ({school}) and its teacher who sends them ({teacher}). Standalone
 * Netfix keeps its own (mission.school, mission.<id>.teacher); a host such as FixIT Classroom sets the real ones with
 * setStoryNames. Every mission text, in the panel and in the help pages, goes through storyText. A host may also put its
 * own line above a mission in place of its chapter (setMissionChapters: FixIT Classroom shows the class's RAs).
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
const LINE_MAX = 120;

let names: StoryNames = {};
let chapters: Readonly<Record<string, string>> = {};

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

/** The host's line above each mission it names, by mission id (an empty object puts Netfix's chapters back). Shown as text. */
export function setMissionChapters(lines: Readonly<Record<string, string>>): void {
  const entries = Object.entries(typeof lines === 'object' && lines !== null ? lines : {}).flatMap(([id, v]) => {
    if (typeof v !== 'string') return [];
    const line = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LINE_MAX).trim();
    return line ? [[id, line] as const] : [];
  });
  chapters = Object.fromEntries(entries);
}

/** The host's line for mission `id`, if it gave one. */
export function missionChapter(id: string): string | undefined {
  return Object.hasOwn(chapters, id) ? chapters[id] : undefined;
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
