/** Device kinds registered from outside the core (S23 extension points): created, saved, loaded and given the host's context. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declareDeviceKind, deviceKinds, registerDeviceKind, type ExtensionDevice } from '../../src/net/device-kinds.ts';
import { Topology } from '../../src/net/topology.ts';
import { validateFile } from '../../src/net/topology-file.ts';
import { DETACHED } from '../../src/devices/hooks.ts';
import { allowsTab, parseRestrictions } from '../../src/classroom/restrictions.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';

class Box implements ExtensionDevice {
  readonly kind = 'ext-box';
  hooks = DETACHED;
  colour = 'grey';
  context: unknown = null;
  readonly id: string;
  name: string;
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  displayName(): string { return this.name; }
  portNames(): readonly string[] { return ['Port0']; }
  portAdminUp(): boolean { return true; }
  receive(): void {}
  onLinkEvent(): void {}
  ownsIp(): boolean { return false; }
}

const file = (kind: string): unknown => ({ format: 'netfix', version: new Topology().toJSON().version, devices: [{ id: 'd0', kind, label: 'X', x: 0, y: 0, seed: 1, config: [], startup: null }], links: [] });

test('an undeclared kind is refused in a file, a restriction and a checklist; declared, all three take it', () => {
  assert.throws(() => validateFile(file('ext-box')), /Dispositivo no válido/);
  assert.throws(() => parseRestrictions({ devices: ['ext-box'] }));
  registerDeviceKind('ext-box', {
    prefix: 'Box', tabs: ['box', 'box-extra'],
    create: (o) => new Box(o.id, o.name),
    save: (d) => ({ colour: (d as Box).colour }),
    load: (d, data) => { (d as Box).colour = typeof data === 'object' && data !== null && typeof (data as { colour?: unknown }).colour === 'string' ? (data as { colour: string }).colour : 'grey'; },
    connect: (d, ctx) => { (d as Box).context = ctx; },
    label: (ctx) => (typeof ctx === 'string' ? ctx : undefined),
  });
  assert.ok(deviceKinds().includes('ext-box'));
  validateFile(file('ext-box'));
  const r = parseRestrictions({ devices: ['pc', 'ext-box'], tabs: { 'ext-box': ['box-extra'] } });
  assert.equal(allowsTab(r, 'ext-box', 'box'), true, 'its first tab is never hidden');
  assert.equal(allowsTab(r, 'ext-box', 'other'), false);
  parseChecklist([{ id: 'a', check: { type: 'device', device: 'Box0', kind: 'ext-box' } }]);
});

test('a registered kind is created with its prefix or the context\'s label, joined to the context, and saved with its settings', () => {
  const t = new Topology();
  const a = t.add('ext-box', 0, 0);
  assert.equal(a.label, 'Box0');
  t.setKindContext('ext-box', 'Aula 3');
  assert.equal((a.device as Box).context, 'Aula 3', 'the devices already placed take the context');
  const b = t.add('ext-box', 10, 0);
  assert.equal(b.label, 'Aula 3', 'a new one is named from the context');
  (a.device as Box).colour = 'red';
  const saved = t.toJSON();
  assert.deepEqual(saved.devices.find((d) => d.id === a.device.id)?.['ext-box'], { colour: 'red' });
  const back = Topology.fromJSON(saved);
  assert.equal((back.byLabel('Box0') as Box).colour, 'red');
  t.remove(a.device.id);
  assert.equal((a.device as Box).context, null, 'removed: it leaves the context');
});

test('a kind cannot take a built-in name or a bad one; declaring twice needs the same tabs', () => {
  const def = { prefix: 'X', tabs: ['x'], create: (o: { id: string; name: string }) => new Box(o.id, o.name), save: () => ({}), load: () => {} };
  assert.throws(() => registerDeviceKind('router', def), /ya existe/);
  assert.throws(() => registerDeviceKind('Bad', def), /nombre/);
  assert.throws(() => registerDeviceKind('ext-box', def), /ya existe/);
  declareDeviceKind('ext-light', { tabs: ['light'] });
  declareDeviceKind('ext-light', { tabs: ['light'] });
  assert.throws(() => declareDeviceKind('ext-light', { tabs: ['other'] }), /ya existe/);
  assert.throws(() => new Topology().add('ext-light', 0, 0), /sin registrar/, 'declared only: no devices of it');
});
