/** 0.87.0: the documentation a host draws in its own help (FixIT Classroom's consoles), as the Documentation tab lists it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownDocGroups } from '../../src/ui/docs-view.ts';
import { loadMissionsPref, setMissionsShown } from '../../src/ui/preferences.ts';
import { searchDocs } from '../../src/docs/index.ts';

test('a host gets the Documentation tab\'s groups, with their device icons, and the labs only with the missions on', () => {
  loadMissionsPref();
  const ids = shownDocGroups().map((g) => g.id);
  assert.deepEqual(ids.slice(0, 7), ['netfix', 'pc', 'servidor', 'switch', 'router', 'linuxrouter', 'nube']);
  assert.equal(shownDocGroups().find((g) => g.id === 'pc')?.icon, 'pc', 'a device group carries its palette icon');
  assert.ok(!ids.includes('labs'), 'missions off by default');
  setMissionsShown(true);
  assert.ok(shownDocGroups().some((g) => g.id === 'labs'));
  setMissionsShown(false);
  assert.ok(shownDocGroups(true).some((g) => g.id === 'labs'), 'a host with the missions on (FixIT Classroom) asks for them');
  assert.ok(searchDocs('dhcp').length > 0, 'search finds pages across groups');
});
