import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missionChapter, setMissionChapters, setStoryNames, storyText } from '../../src/labs/story.ts';

test('without a host, the missions keep their own cast: IES Aula, Rafael and Jorge', () => {
  setStoryNames({});
  assert.equal(storyText('mission.basico.from', undefined, 'es-ES'), 'Rafael (jefatura de estudios, IES Aula)');
  assert.match(storyText('mission.nombres-redes.from', undefined, 'en-GB'), /^Jorge \(.*IES Aula\)$/);
  assert.match(storyText('mission.chapter.dhcp.intro', undefined, 'es-ES'), /IES Aula/);
  assert.equal(storyText('mission.relay.from', undefined, 'es-ES'), 'Andrés, responsable de la sede B', 'a client, not the school: unchanged');
});

test('a host (FixIT Classroom) puts the real school and teacher in every mission; the head of studies stays Rafael', () => {
  setStoryNames({ school: 'IES Río Duero', teacher: 'Pilar' });
  assert.equal(storyText('mission.nombres-redes.from', undefined, 'en-GB'), 'Pilar (IT department, IES Río Duero)');
  assert.equal(storyText('mission.reservas.from', undefined, 'es-ES'), 'Pilar (coordinación TIC, IES Río Duero)');
  assert.equal(storyText('mission.basico.from', undefined, 'es-ES'), 'Rafael (jefatura de estudios, IES Río Duero)', 'never the host\'s teacher');
  assert.equal(storyText('mission.basico-linux.from', undefined, 'en-GB'), 'Rafael (head of studies, IES Río Duero)');
  assert.match(storyText('mission.chapter.services.intro', undefined, 'es-ES'), /IES Río Duero/);
  assert.equal(storyText('mission.ui.from', { who: 'X' }, 'es-ES'), 'Aviso de X', 'other keys and their params as they were');
  setStoryNames({ school: 'Colegio Sol' });
  assert.match(storyText('mission.reservas.from', undefined, 'es-ES'), /^Carmen \(.*Colegio Sol\)$/, 'a missing name keeps the default');
  setStoryNames({});
});

test('names from a host are cleaned: no markdown or links into the help pages, trimmed and capped', () => {
  setStoryNames({ school: '  **[IES](javascript:alert(1))**  ', teacher: `${'A'.repeat(200)}\u0000` });
  const from = storyText('mission.nombres-redes.from', undefined, 'es-ES');
  assert.doesNotMatch(from, /[*[\]`_<>\u0000]/);
  assert.ok(from.length < 200, from);
  setStoryNames({ school: '   ', teacher: '***' });
  assert.match(storyText('mission.nombres-redes.from', undefined, 'es-ES'), /^Jorge \(.*IES Aula\)$/, 'nothing left: the default');
  setStoryNames({});
});

test('a host may put its own line above a mission in place of its chapter (FixIT Classroom: the class\'s RAs)', () => {
  setMissionChapters({ basico: '0225-RA3 · 0375-RA2', relay: '  RA 4  ' });
  assert.equal(missionChapter('basico'), '0225-RA3 · 0375-RA2');
  assert.equal(missionChapter('relay'), 'RA 4', 'trimmed');
  assert.equal(missionChapter('reservas'), undefined, 'a mission it does not name keeps its chapter');
  setMissionChapters({ basico: `x\u0000\n${'y'.repeat(300)}`, cliente: 42, relay: '   ' } as unknown as Record<string, string>);
  const line = missionChapter('basico') ?? '';
  assert.doesNotMatch(line, /[\u0000-\u001f]/, 'no control characters');
  assert.ok(line.length <= 120, `capped: ${line.length}`);
  assert.equal(missionChapter('cliente'), undefined, 'not a string: ignored');
  assert.equal(missionChapter('relay'), undefined, 'blank: ignored');
  setMissionChapters({});
  assert.equal(missionChapter('basico'), undefined, '{} puts the chapters back');
});
