/**
 * Labs of an extension (0.99.0): a host's pack adds a lab — with its guided mission, if any — after Netfix's own, in one
 * of the Labs menu's chapters, with its texts (lab.<id>.*, mission.<id>.*) in both languages. Once registered it is a
 * lab like the others: the Labs menu, the host's `labs()`, the mission panel, its page in Ayuda de Netfix.
 */
import { EXAMPLES, addExample } from '../net/examples.ts';
import type { Example } from '../net/examples.ts';
import { addToGroup } from './lab-groups.ts';
import type { LabGroupId } from './lab-groups.ts';
import { addMission } from './missions.ts';
import type { Mission } from './missions.ts';
import { addMissionPlan } from './mission-plans.ts';
import { addMessages } from '../i18n/catalog.ts';
import type { Locale } from '../i18n/locale.ts';

export interface ExtensionLab {
  readonly example: Example;
  readonly group: LabGroupId;
  readonly mission?: Mission;
  /** Its texts: lab.<id>.title and .summary, and the mission's (mission.<id>.from, .ticket, .task.N…). */
  readonly messages: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
}

/** Adds `lab` once (a second call with the same id does nothing); its id must not be one of Netfix's. */
export function registerLab(lab: ExtensionLab): void {
  const { id } = lab.example;
  if (lab.mission && lab.mission.id !== id) throw new Error(`registerLab: the mission of ${id} has another id`);
  if (EXAMPLES.some((e) => e.id === id)) return;
  addMessages('es-ES', lab.messages['es-ES']);
  addMessages('en-GB', lab.messages['en-GB']);
  addExample(lab.example);
  addToGroup(lab.group, id);
  if (lab.mission) {
    addMissionPlan(lab.mission);
    addMission(lab.mission);
  }
}
