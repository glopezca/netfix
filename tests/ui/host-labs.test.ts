/** handle.labs() (0.77.0): the labs a host can open, in the Labs menu's order, with their chapter and whether they have a mission. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostLabs } from '../../src/ui/host-labs.ts';
import { LAB_GROUPS } from '../../src/labs/lab-groups.ts';
import { NO_RESTRICTIONS, parseRestrictions } from '../../src/classroom/restrictions.ts';
import { setLocale } from '../../src/i18n/locale.ts';

test('every lab, in the menu\'s order, with its title, chapter and mission', () => {
  const labs = hostLabs(NO_RESTRICTIONS);
  assert.deepEqual(labs.map((l) => l.id), LAB_GROUPS.flatMap(([, ids]) => ids));
  const basico = labs.find((l) => l.id === 'basico');
  assert.deepEqual(basico, { id: 'basico', title: 'DHCP básico', chapter: 'dhcp', chapterTitle: 'Capítulo 1 · Sin dirección no hay red', mission: true });
  assert.equal(labs.find((l) => l.id === 'stp')?.mission, false, 'a lab with no mission yet');
  setLocale('en-GB');
  try {
    assert.notEqual(hostLabs(NO_RESTRICTIONS).find((l) => l.id === 'basico')?.title, 'DHCP básico', 'titles in Netfix\'s language');
  } finally {
    setLocale('es-ES');
  }
});

test('only the labs the restrictions allow', () => {
  assert.deepEqual(hostLabs(parseRestrictions({ labs: ['relay', 'basico'] })).map((l) => l.id), ['basico', 'relay']);
  assert.deepEqual(hostLabs(parseRestrictions({ labs: [] })), []);
});
