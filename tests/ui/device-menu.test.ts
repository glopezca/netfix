/** The device context menu (extension SDK): Abrir, the extensions' entries for that device, then Eliminar. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { menuEntries, registerDeviceAction } from '../../src/ui/device-menu.ts';

test('entries: Abrir first, an extension\'s only on the devices it applies to, Eliminar last and only when editable', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0);
  const sw = t.add('switch', 100, 0);
  const runs: string[] = [];
  registerDeviceAction({ id: 'xsample-open', label: { es: 'Abrir en Ejemplo', en: 'Open in Sample' }, applies: (p) => p.device.kind === 'pc', run: (p) => { runs.push(p.label); } });
  const labels = (p: typeof pc, editable: boolean): string[] => menuEntries(p, editable, 'es-ES').map((e) => e.label);
  assert.deepEqual(labels(pc, true), ['Abrir', 'Abrir en Ejemplo', 'Eliminar']);
  assert.deepEqual(labels(pc, false), ['Abrir', 'Abrir en Ejemplo'], 'a locked lab deletes nothing');
  assert.deepEqual(labels(sw, true), ['Abrir', 'Eliminar']);
  assert.deepEqual(menuEntries(pc, true, 'en-GB').map((e) => e.label), ['Open', 'Open in Sample', 'Delete']);
  const ext = menuEntries(pc, true, 'es-ES').find((e) => e.id === 'xsample-open');
  ext?.run?.(pc);
  assert.deepEqual(runs, [pc.label]);
});

test('registerDeviceAction: one id each, a valid id, both languages', () => {
  registerDeviceAction({ id: 'xsample-twice', label: { es: 'A', en: 'A' }, applies: () => true, run: () => undefined });
  assert.throws(() => registerDeviceAction({ id: 'xsample-twice', label: { es: 'B', en: 'B' }, applies: () => true, run: () => undefined }), /ya existe/);
  assert.throws(() => registerDeviceAction({ id: 'open', label: { es: 'B', en: 'B' }, applies: () => true, run: () => undefined }), /ya existe/, 'not over a core entry');
  assert.throws(() => registerDeviceAction({ id: 'Mal Id', label: { es: 'B', en: 'B' }, applies: () => true, run: () => undefined }), /no válido/);
  assert.throws(() => registerDeviceAction({ id: 'xsample-nolabel', label: { es: '', en: 'B' }, applies: () => true, run: () => undefined }), /texto/);
});
