/**
 * Guided labs (missions): each one starts broken or unfinished, its rubric fails there and scores full marks on the
 * solved lab, names only devices that exist, and has every text (ticket, tasks, three hints per task) in both languages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, missionById } from '../../src/labs/missions.ts';
import { missionStart, missionSolved, missionRubric, missionKeys, startLab, viewSolution } from '../../src/labs/mission-build.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { LAB_GROUPS } from '../../src/labs/lab-groups.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { CATALOGS } from '../../src/i18n/catalog.ts';
import type { Check } from '../../src/classroom/checklist.ts';

function devicesOf(c: Check): string[] {
  if ('device' in c) return [c.device];
  if (c.type === 'link') return [c.a, c.b];
  return [c.from];
}

for (const m of MISSIONS) {
  test(`mission ${m.id}: starts unsolved, the solution scores full marks`, () => {
    const rubric = missionRubric(m, 'es-ES');
    const start = evaluate(missionStart(m.id).toJSON(), rubric);
    const failed = start.items.filter((i) => !i.passed).map((i) => i.id);
    assert.ok(failed.length > 0, 'the starting lab already passes everything');
    const solved = evaluate(missionSolved(m.id).toJSON(), rubric);
    const missing = solved.items.filter((i) => !i.passed).map((i) => `${i.id}: ${i.detail}`);
    assert.deepEqual(missing, [], 'the solved lab fails');
    assert.equal(solved.score, solved.max);
  });

  test(`mission ${m.id}: tasks, rubric devices and texts`, () => {
    assert.ok(EXAMPLES.some((e) => e.id === m.id), 'a mission is one of the labs');
    assert.equal(missionById(m.id), m);
    const topo = missionStart(m.id);
    assert.deepEqual(topo.mission, { id: m.id, hints: [] });
    const labels = new Set([...topo.placed.values()].map((p) => p.label));
    for (const item of m.items) {
      assert.ok(item.task >= 1 && item.task <= m.tasks, `${item.id}: task ${item.task}`);
      for (const d of devicesOf(item.check)) assert.ok(labels.has(d), `${item.id}: no device ${d}`);
    }
    for (let n = 1; n <= m.tasks; n++) assert.ok(m.items.some((i) => i.task === n), `task ${n} has nothing to check`);
    for (const locale of ['es-ES', 'en-GB'] as const) {
      const table = CATALOGS[locale] as Readonly<Record<string, string>>;
      for (const key of missionKeys(m)) assert.ok(table[key]?.trim(), `${locale}: ${key}`);
      assert.doesNotThrow(() => parseChecklist(missionRubric(m, locale)), locale);
    }
  });
}

test('opening a lab starts its mission broken; a lab with no mission opens as built', () => {
  const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!;
  assert.deepEqual(startLab(ex('basico')).mission, { id: 'basico', hints: [] });
  const plain = EXAMPLES.find((e) => !missionById(e.id));
  if (plain) assert.equal(startLab(plain).mission, undefined);
});

test('View solution keeps the hints read and records that the solution was seen', () => {
  const m = missionById('basico')!;
  const topo = viewSolution({ id: 'basico', hints: ['1.1', '3.2'] });
  assert.deepEqual(topo.mission, { id: 'basico', hints: ['1.1', '3.2'], solution: true });
  const r = evaluate(topo.toJSON(), missionRubric(m, 'es-ES'));
  assert.equal(r.score, r.max);
  assert.deepEqual(r.mission, { id: 'basico', hints: 2, solution: true });
});

test('missions are listed once, in the order of the labs menu', () => {
  const ids = MISSIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  const order = LAB_GROUPS.flatMap(([, labs]) => labs);
  assert.deepEqual([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)), ids);
});

test('every mission text key belongs to a mission (no leftovers)', () => {
  const known = new Set(MISSIONS.flatMap((m) => missionKeys(m)));
  const extra = Object.keys(CATALOGS['es-ES']).filter((k) => /^mission\.(?!chapter\.|prologue|ui\.|doc\.)/.test(k) && !known.has(k));
  assert.deepEqual(extra, []);
});
