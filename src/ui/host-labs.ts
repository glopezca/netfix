/**
 * The labs a host page can open (`handle.labs()`, 0.77.0): those the restrictions allow, in the order of the Labs menu,
 * with their title in Netfix's language, their chapter and whether they have a mission. A host builds its own menu from
 * this (FixIT Classroom groups them by its curriculum) and opens one with `handle.openLab(id)`.
 */
import { EXAMPLES } from '../net/examples.ts';
import { LAB_GROUPS } from '../labs/lab-groups.ts';
import type { LabGroupId } from '../labs/lab-groups.ts';
import { missionById } from '../labs/missions.ts';
import { allowsLab } from '../classroom/restrictions.ts';
import type { Restrictions } from '../classroom/restrictions.ts';
import { tDynamic } from '../i18n/t.ts';
import { labText } from './lab-text.ts';

export interface HostLab {
  readonly id: string;
  readonly title: string;
  readonly chapter: LabGroupId;
  readonly chapterTitle: string;
  readonly mission: boolean;
}

export function hostLabs(policy: Restrictions): HostLab[] {
  return LAB_GROUPS.flatMap(([chapter, ids]) => ids.flatMap((id) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex || !allowsLab(policy, id)) return [];
    return [{ id, title: labText(ex).title, chapter, chapterTitle: tDynamic(`mission.chapter.${chapter}`), mission: missionById(id) !== undefined }];
  }));
}
