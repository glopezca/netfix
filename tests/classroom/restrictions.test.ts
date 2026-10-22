/** Restriction policy for embedding Netfix (classroom): validated JSON, permissive by default. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_RESTRICTIONS, parseRestrictions, allowsLab, allowsDevice, allowsTab, lockedPrompt } from '../../src/classroom/restrictions.ts';

test('no restrictions allow everything', () => {
  assert.equal(allowsLab(NO_RESTRICTIONS, 'basico'), true);
  assert.equal(allowsDevice(NO_RESTRICTIONS, 'linuxrouter'), true);
  assert.equal(allowsTab(NO_RESTRICTIONS, 'pc', 'linux'), true);
  assert.deepEqual(parseRestrictions(undefined), NO_RESTRICTIONS);
  assert.deepEqual(parseRestrictions({}), NO_RESTRICTIONS);
});

test('labs, devices and tabs per device kind can be limited', () => {
  const r = parseRestrictions({ labs: ['basico', 'relay'], devices: ['pc', 'switch', 'router'], tabs: { pc: ['ip', 'windows'], router: ['cli'] }, docs: false, fileOpen: false, drawing: false });
  assert.equal(allowsLab(r, 'basico'), true);
  assert.equal(allowsLab(r, 'vpn-ipsec'), false);
  assert.equal(allowsDevice(r, 'server'), false);
  assert.equal(allowsTab(r, 'pc', 'windows'), true);
  assert.equal(allowsTab(r, 'pc', 'linux'), false);
  assert.equal(allowsTab(r, 'router', 'web'), false);
  assert.equal(allowsTab(r, 'server', 'svc'), true, 'a kind without a tab list keeps all its tabs');
  assert.equal(r.docs, false);
  assert.equal(r.fileOpen, false);
  assert.equal(r.fileSave, true);
  assert.equal(r.drawing, false);
});

test('an empty list allows none; the window always keeps one tab', () => {
  const r = parseRestrictions({ labs: [], tabs: { pc: [] } });
  assert.equal(allowsLab(r, 'basico'), false);
  assert.equal(allowsTab(r, 'pc', 'host'), true, 'the Device tab stays so the window is never empty');
  assert.equal(allowsTab(r, 'pc', 'linux'), false);
});

test('untrusted JSON is validated: unknown kinds, tabs, keys or types are rejected', () => {
  for (const bad of [
    'x', [], { devices: ['toaster'] }, { tabs: { pc: ['root-shell'] } }, { tabs: { fridge: ['ip'] } },
    { labs: ['x'.repeat(100)] }, { labs: Array.from({ length: 200 }, (_, i) => `l${i}`) }, { docs: 'no' }, { unknown: true },
  ]) assert.throws(() => parseRestrictions(bad), /restricciones|restrictions/i, JSON.stringify(bad).slice(0, 60));
});

test('timestampPrompt: free by default; "on"/"off" lock the timestamp prompt of every device', () => {
  assert.equal(NO_RESTRICTIONS.timestampPrompt, 'free');
  assert.equal(parseRestrictions({}).timestampPrompt, 'free');
  assert.equal(parseRestrictions({ timestampPrompt: 'on' }).timestampPrompt, 'on');
  assert.equal(parseRestrictions({ timestampPrompt: 'off' }).timestampPrompt, 'off');
  assert.equal(parseRestrictions({ timestampPrompt: 'free' }).timestampPrompt, 'free');
  assert.equal(lockedPrompt(parseRestrictions({ timestampPrompt: 'on' })), true);
  assert.equal(lockedPrompt(parseRestrictions({ timestampPrompt: 'off' })), false);
  assert.equal(lockedPrompt(NO_RESTRICTIONS), undefined);
  assert.throws(() => parseRestrictions({ timestampPrompt: true }), /timestampPrompt/);
  assert.throws(() => parseRestrictions({ timestampPrompt: 'yes' }), /timestampPrompt/);
});
