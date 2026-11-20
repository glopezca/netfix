import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_HOST, checkMount, labOptions, takeHostOptions } from '../../src/ui/embed-api.ts';
import { registerClassLanUi } from '../../src/ui/classlan-kind.ts';

registerClassLanUi(); // the host option «classroomLan» (S23: an extension's, ui/host-options.ts)

test('netfix.embed needs an element to mount on', () => {
  assert.throws(() => checkMount('#app'), /elemento/);
  assert.throws(() => checkMount(undefined), /elemento/);
});

test('host options: none leaves the options as they were; a bad toolbar, locale, confirmUnsaved or palette is refused', () => {
  const mount = {} as HTMLElement;
  const options = { restrictions: {} };
  assert.deepEqual(takeHostOptions(mount, options), { rest: options, host: NO_HOST });
  assert.deepEqual(takeHostOptions(mount, undefined), { rest: undefined, host: NO_HOST });
  const taken = takeHostOptions(mount, { restrictions: {}, locale: 'en-GB', confirmUnsaved: false });
  assert.deepEqual({ rest: { ...taken.rest as object }, host: { ...taken.host, extensions: { ...taken.host.extensions } } },
    { rest: { restrictions: {} }, host: { toolbar: null, actions: null, locale: 'en-GB', confirmUnsaved: false, palette: 'side', piles: undefined, extensions: {} } });
  assert.equal(takeHostOptions(mount, { palette: 'bottom' }).host.palette, 'bottom');
  assert.throws(() => takeHostOptions(mount, { toolbar: '#bar' }), /toolbar/);
  assert.throws(() => takeHostOptions(mount, { actions: '#acts' }), /actions/);
  assert.throws(() => takeHostOptions(mount, { locale: 'fr-FR' }), /locale/);
  assert.throws(() => takeHostOptions(mount, { confirmUnsaved: 'no' }), /confirmUnsaved/);
  assert.throws(() => takeHostOptions(mount, { palette: 'top' }), /palette/);
  assert.equal(takeHostOptions(mount, { piles: true }).host.piles, true, 'a host piles similar devices');
  const link = { lab: 2, name: '  1º SMR B  ', send: () => {}, onMessage: () => () => {} };
  assert.equal(takeHostOptions(mount, { classroomLan: link }).host.extensions.classroomLan?.name, '1º SMR B', 'the class name, trimmed');
  assert.equal(takeHostOptions(mount, { classroomLan: { ...link, name: 7 } }).host.extensions.classroomLan?.name, undefined, 'a name that is not text is left out');
  assert.throws(() => takeHostOptions(mount, { piles: 'yes' }), /piles/);
  // Netfix Classroom's LAN: a lab number and the two functions, nothing else.
  const lan = takeHostOptions(mount, { classroomLan: { lab: 3, send: () => undefined, onMessage: () => () => undefined } }).host.extensions.classroomLan;
  assert.equal(lan?.lab, 3);
  for (const bad of [{ lab: 0, send: () => undefined, onMessage: () => () => undefined }, { lab: 3, send: 'x', onMessage: () => () => undefined }, 'lan']) {
    assert.throws(() => takeHostOptions(mount, { classroomLan: bad }), /classroomLan/);
  }
});

test('netfix.lab takes no option but the host ones', () => {
  const mount = {} as HTMLElement;
  assert.equal(labOptions(mount, undefined), NO_HOST);
  assert.equal(labOptions(mount, {}).toolbar, null);
  assert.equal(labOptions(mount, { locale: 'es-ES' }).locale, 'es-ES');
  for (const bad of [{ autosave: false }, 'x', [1]]) assert.throws(() => labOptions(mount, bad), /solo admite/);
});

test('an own «__proto__» key stays an option of its own: embed rejects it, it does not set the prototype', () => {
  const { rest } = takeHostOptions({} as HTMLElement, JSON.parse('{"locale":"es-ES","__proto__":{"topology":1}}'));
  assert.deepEqual(Object.keys(rest as object), ['__proto__']);
  assert.equal((rest as Record<string, unknown>).topology, undefined);
});
