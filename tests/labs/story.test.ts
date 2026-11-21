import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setStoryNames, storyText } from '../../src/labs/story.ts';

test('without a host, the missions keep their own cast: IES Aula, Lucía and Jorge', () => {
  setStoryNames({});
  assert.match(storyText('mission.basico.from', undefined, 'es-ES'), /^Lucía \(.*IES Aula\)$/);
  assert.match(storyText('mission.nombres-redes.from', undefined, 'en-GB'), /^Jorge \(.*IES Aula\)$/);
  assert.match(storyText('mission.chapter.dhcp.intro', undefined, 'es-ES'), /IES Aula/);
  assert.equal(storyText('mission.relay.from', undefined, 'es-ES'), 'Andrés, responsable de la sede B', 'a client, not the school: unchanged');
});

test('a host (FixIT Classroom) puts the real school and teacher in every mission', () => {
  setStoryNames({ school: 'IES Río Duero', teacher: 'Pilar Gómez' });
  assert.equal(storyText('mission.basico.from', undefined, 'es-ES'), 'Pilar Gómez (jefatura de estudios, IES Río Duero)');
  assert.equal(storyText('mission.nombres-redes.from', undefined, 'en-GB'), 'Pilar Gómez (IT department, IES Río Duero)');
  assert.match(storyText('mission.chapter.services.intro', undefined, 'es-ES'), /IES Río Duero/);
  assert.equal(storyText('mission.ui.from', { who: 'X' }, 'es-ES'), 'Aviso de X', 'other keys and their params as they were');
  setStoryNames({ school: 'Colegio Sol' });
  assert.match(storyText('mission.basico.from', undefined, 'es-ES'), /^Lucía \(.*Colegio Sol\)$/, 'a missing name keeps the default');
  setStoryNames({});
});

test('names from a host are cleaned: no markdown or links into the help pages, trimmed and capped', () => {
  setStoryNames({ school: '  **[IES](javascript:alert(1))**  ', teacher: `${'A'.repeat(200)}\u0000` });
  const from = storyText('mission.basico.from', undefined, 'es-ES');
  assert.doesNotMatch(from, /[*[\]`_<>\u0000]/);
  assert.ok(from.length < 200, from);
  setStoryNames({ school: '   ', teacher: '***' });
  assert.match(storyText('mission.basico.from', undefined, 'es-ES'), /^Lucía \(.*IES Aula\)$/, 'nothing left: the default');
  setStoryNames({});
});
