/** 0.99.0: a lab registered by an extension is one more lab — the list, its chapter, its mission, its texts, its help page. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLab } from '../../src/labs/extension-labs.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { LAB_GROUPS } from '../../src/labs/lab-groups.ts';
import { MISSIONS, missionById } from '../../src/labs/missions.ts';
import { MISSION_PLANS } from '../../src/labs/mission-plans.ts';
import { tDynamic } from '../../src/i18n/t.ts';
import { Topology } from '../../src/net/topology.ts';
import { hostLabs } from '../../src/ui/host-labs.ts';
import { NO_RESTRICTIONS } from '../../src/classroom/restrictions.ts';

const ext = {
  example: { id: 'ext-web', title: 'Web', summary: 'A web lab', build: () => new Topology() },
  group: 'services' as const,
  mission: { id: 'ext-web', tasks: 1, docs: [], items: [{ id: 'pc', task: 1, check: { type: 'device' as const, device: 'PC0' } }] },
  messages: { 'es-ES': { 'lab.ext-web.title': 'Web de prueba', 'lab.basico.title': 'otro' }, 'en-GB': { 'lab.ext-web.title': 'Test web' } },
};

test('registered once: after Netfix\'s labs, in its chapter, with its mission and texts; Netfix\'s texts stay', () => {
  const before = EXAMPLES.length;
  const basico = tDynamic('lab.basico.title', undefined, 'es-ES');
  registerLab(ext);
  registerLab(ext);
  assert.equal(EXAMPLES.length, before + 1);
  assert.equal(EXAMPLES.at(-1)?.id, 'ext-web');
  assert.equal(LAB_GROUPS.find(([g]) => g === 'services')?.[1].at(-1), 'ext-web');
  assert.equal(missionById('ext-web')?.tasks, 1);
  assert.equal(MISSIONS.filter((m) => m.id === 'ext-web').length, 1);
  assert.ok(MISSION_PLANS.some((m) => m.id === 'ext-web'));
  assert.equal(tDynamic('lab.ext-web.title', undefined, 'es-ES'), 'Web de prueba');
  assert.equal(tDynamic('lab.ext-web.title', undefined, 'en-GB'), 'Test web');
  assert.equal(tDynamic('lab.basico.title', undefined, 'es-ES'), basico, 'an extension never replaces Netfix\'s texts');
  const mine = hostLabs(NO_RESTRICTIONS).find((l) => l.id === 'ext-web');
  assert.deepEqual(mine && { title: mine.title, chapter: mine.chapter, mission: mine.mission }, { title: 'Web de prueba', chapter: 'services', mission: true });
});

test('a mission with another id is refused', () => {
  assert.throws(() => registerLab({ ...ext, example: { ...ext.example, id: 'ext-other' } }), /another id/);
});
