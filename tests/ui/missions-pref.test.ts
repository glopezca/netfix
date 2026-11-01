/** Configuración → Generales: the guided labs (missions) show only when the option is on, which it is not by default. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomMissions, loadMissionsPref, missionsShown, onMissionsShown, setMissionsShown } from '../../src/ui/preferences.ts';

test('missions are hidden by default and the setting notifies whoever shows them until they stop listening', () => {
  loadMissionsPref();
  assert.equal(missionsShown(), false, 'off unless turned on');
  const seen: boolean[] = [];
  const stop = onMissionsShown(() => seen.push(missionsShown()));
  setMissionsShown(true);
  assert.equal(missionsShown(), true);
  setMissionsShown(false);
  stop();
  setMissionsShown(true);
  assert.deepEqual(seen, [true, false], 'nothing after stop()');
  setMissionsShown(false);
});

test('in the classroom missions always show', () => {
  loadMissionsPref();
  classroomMissions();
  assert.equal(missionsShown(), true);
  loadMissionsPref();
  assert.equal(missionsShown(), false, 'a standalone start reads the browser again');
});
