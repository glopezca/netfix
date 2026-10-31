/**
 * Builds a mission's starting and solved topologies from its lab, its rubric as a classroom checklist in one
 * language, and the catalogue keys of its texts.
 */
import { EXAMPLES } from '../net/examples.ts';
import type { Example } from '../net/examples.ts';
import type { Topology } from '../net/topology.ts';
import type { MissionState } from './mission-state.ts';
import { Host } from '../devices/host.ts';
import { tDynamic } from '../i18n/t.ts';
import type { Locale } from '../i18n/locale.ts';
import type { ChecklistItem } from '../classroom/checklist.ts';
import { missionById } from './missions.ts';
import type { Mission } from './missions.ts';
import { HINT_LEVELS } from './mission-plans.ts';

function lab(id: string): { mission: Mission; topo: Topology } {
  const mission = missionById(id);
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!mission || !ex) throw new Error(`no mission ${id}`);
  return { mission, topo: ex.build() };
}

/** After a change to servers or relays the DHCP clients ask again, as after a reboot. */
function renew(t: Topology): Topology {
  for (const p of t.placed.values()) if (p.device instanceof Host && p.device.config.mode === 'dhcp') p.device.useDhcp();
  t.settle();
  return t;
}

/** The lab as the student receives it. */
export function missionStart(id: string): Topology {
  const { mission, topo } = lab(id);
  mission.start?.(topo);
  topo.mission = { id, hints: [] };
  return renew(topo);
}

/** The lab with the mission done ("View solution"). */
export function missionSolved(id: string): Topology {
  const { mission, topo } = lab(id);
  mission.solve?.(topo);
  topo.mission = { id, hints: [] };
  return renew(topo);
}

/** What the Labs menu opens: the mission's starting state, or the lab as built when it has no mission. */
export function startLab(ex: Example): Topology {
  return missionById(ex.id) ? missionStart(ex.id) : ex.build();
}

/** "View solution": the solved lab, keeping the hints already read and recording that the solution was seen. */
export function viewSolution(state: MissionState): Topology {
  const topo = missionSolved(state.id);
  topo.mission = { ...state, solution: true };
  return topo;
}

/** The rubric as a checklist, titled in `locale`. */
export function missionRubric(m: Mission, locale?: Locale): readonly ChecklistItem[] {
  return m.items.map((i) => ({ id: i.id, weight: i.weight ?? 1, title: tDynamic(`mission.${m.id}.check.${i.id}`, {}, locale), check: i.check }));
}

export const taskKey = (m: Mission, n: number): string => `mission.${m.id}.task.${n}`;
export const hintKey = (m: Mission, n: number, level: number): string => `mission.${m.id}.hint.${n}.${level}`;

/** Every catalogue key the mission's texts need. */
export function missionKeys(m: Mission): string[] {
  const base = ['from', 'ticket', 'purpose', 'debrief', 'solution'].map((k) => `mission.${m.id}.${k}`);
  const tasks = Array.from({ length: m.tasks }, (_, i) => [taskKey(m, i + 1), ...Array.from({ length: HINT_LEVELS }, (_, l) => hintKey(m, i + 1, l + 1))]).flat();
  return [...base, ...tasks, ...m.items.map((i) => `mission.${m.id}.check.${i.id}`)];
}
