/**
 * Help pages of the guided labs (missions), built from the plans and the catalogue so they never drift from the
 * mission panel: the story, what the lab is for, the tasks with their hints folded, the rubric and the solution.
 * Only pure data is imported (no simulator), so the documentation stays free of import cycles.
 */
import type { DocBlock, DocPage } from './types.ts';
import type { OutlineGroup } from './outline.ts';
import { p, h, list, note, steps, table } from './types.ts';
import type { Locale } from '../i18n/locale.ts';
import { tDynamic } from '../i18n/t.ts';
import { LAB_GROUPS } from '../labs/lab-groups.ts';
import { HINT_LEVELS, MISSION_PLANS } from '../labs/mission-plans.ts';
import type { MissionPlan } from '../labs/mission-plans.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';
/** Steps of «A mission, step by step» (mission.doc.step.N). */
const STEPS = 5;

type Tr = (key: string, params?: Record<string, string | number>) => string;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** The page id of a mission in the Help view. */
export const labPageId = (id: string): string => `lab-${id}`;

/** Ids of the labs of a group that have a mission, in menu order. */
export function missionIds(ids: readonly string[]): string[] {
  return ids.filter((id) => MISSION_PLANS.some((m) => m.id === id));
}

function hintsCallout(m: MissionPlan, n: number, tr: Tr): DocBlock {
  const hint = (l: number): string => `**${tr('mission.ui.hint', { n: l })}.** ${tr(`mission.${m.id}.hint.${n}.${l}`)}`;
  return {
    kind: 'callout', tone: 'tip', title: tr('mission.doc.hints', { n }), text: hint(1),
    solution: range(HINT_LEVELS).slice(1).map(hint).join('\n\n'), solutionLabel: tr('mission.doc.moreHints'),
  };
}

function rubric(m: MissionPlan, tr: Tr): DocBlock[] {
  const rows = m.items.map((i) => [String(i.task), tr(`mission.${m.id}.check.${i.id}`), String(i.weight ?? 1)]);
  return [h(tr('mission.doc.rubric')), table([tr('mission.doc.colTask'), tr('mission.doc.colCheck'), tr('mission.doc.colPoints')], rows), p(tr('mission.doc.scoring'))];
}

function labPage(m: MissionPlan, locale: Locale, others: readonly DocPage[]): DocPage {
  const tr: Tr = (key, params) => tDynamic(key, params, locale);
  const k = `mission.${m.id}`;
  const group = LAB_GROUPS.find(([, ids]) => ids.includes(m.id))?.[0];
  const further = m.docs.flatMap((id) => others.find((o) => o.id === id)?.title ?? []);
  const blocks: DocBlock[] = [
    h(tr('mission.doc.story')),
    ...(group ? [p(tr(`mission.chapter.${group}.intro`))] : []),
    note(`**${tr('mission.ui.from', { who: tr(`${k}.from`) })}:** ${tr(`${k}.ticket`)}`),
    h(tr('mission.ui.purpose')), p(tr(`${k}.purpose`)),
    h(tr('mission.ui.tasks')),
    steps(...range(m.tasks).map((n) => [`${tr('mission.doc.colTask')} ${n}`, tr(`${k}.task.${n}`)] as const)),
    ...range(m.tasks).map((n) => hintsCallout(m, n, tr)),
    ...rubric(m, tr),
    { kind: 'callout', tone: 'exercise', title: tr('mission.doc.solution'), text: tr('mission.doc.solutionText'), solution: `${tr(`${k}.solution`)}\n\n${tr(`${k}.debrief`)}` },
    ...(further.length ? [h(tr('mission.ui.docs')), list(...further)] : []),
  ];
  const summary = `${group ? `${tr(`mission.chapter.${group}`)}. ` : ''}${tr('mission.ui.from', { who: tr(`${k}.from`) })}.`;
  return { id: labPageId(m.id), title: tr(`lab.${m.id}.title`), summary, blocks, markdownBase: MD };
}

function introPage(locale: Locale): DocPage {
  const tr: Tr = (key, params) => tDynamic(key, params, locale);
  const chapters = LAB_GROUPS.filter(([, ids]) => missionIds(ids).length).map(([g]) => `**${tr(`mission.chapter.${g}`)}.** ${tr(`mission.chapter.${g}.intro`)}`);
  return {
    id: 'labs-intro', title: tr('mission.doc.introTitle'), summary: tr('mission.doc.introSummary'), markdownBase: MD,
    blocks: [
      p(tr('mission.prologue')),
      h(tr('mission.doc.how')),
      steps(...range(STEPS).map((n) => [tr(`mission.doc.step.${n}.title`), tr(`mission.doc.step.${n}.text`)] as const)),
      h(tr('mission.doc.chapters')), list(...chapters),
    ],
  };
}

/** The Labs group of the outline: how missions work, then a section per chapter with its missions. */
export function labsOutline(locale: Locale, title: string): OutlineGroup {
  const chapters = LAB_GROUPS.map(([g, ids]) => [tDynamic(`mission.chapter.${g}`, {}, locale), missionIds(ids).map(labPageId)] as const);
  return { id: 'labs', title, icon: 'mission', sections: [[null, ['labs-intro']], ...chapters.filter(([, ids]) => ids.length)] };
}

/** The pages of the missions in `locale`; `others` are the rest of the pages, to name the further reading. */
export function labDocs(locale: Locale, others: readonly DocPage[]): DocPage[] {
  return [introPage(locale), ...MISSION_PLANS.map((m) => labPage(m, locale, others))];
}
