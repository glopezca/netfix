import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_HOST, checkMount, labOptions, takeHostOptions } from '../../src/ui/embed-api.ts';

test('netfix.embed needs an element to mount on', () => {
  assert.throws(() => checkMount('#app'), /elemento/);
  assert.throws(() => checkMount(undefined), /elemento/);
});

test('host options: none leaves the options as they were; a bad toolbar, locale or confirmUnsaved is refused', () => {
  const mount = {} as HTMLElement;
  const options = { restrictions: {} };
  assert.deepEqual(takeHostOptions(mount, options), { rest: options, host: NO_HOST });
  assert.deepEqual(takeHostOptions(mount, undefined), { rest: undefined, host: NO_HOST });
  assert.deepEqual(takeHostOptions(mount, { restrictions: {}, locale: 'en-GB', confirmUnsaved: false }),
    { rest: { restrictions: {} }, host: { toolbar: null, actions: null, locale: 'en-GB', confirmUnsaved: false } });
  assert.throws(() => takeHostOptions(mount, { toolbar: '#bar' }), /toolbar/);
  assert.throws(() => takeHostOptions(mount, { actions: '#acts' }), /actions/);
  assert.throws(() => takeHostOptions(mount, { locale: 'fr-FR' }), /locale/);
  assert.throws(() => takeHostOptions(mount, { confirmUnsaved: 'no' }), /confirmUnsaved/);
});

test('netfix.lab takes no option but the host ones', () => {
  const mount = {} as HTMLElement;
  assert.equal(labOptions(mount, undefined), NO_HOST);
  assert.equal(labOptions(mount, {}).toolbar, null);
  assert.equal(labOptions(mount, { locale: 'es-ES' }).locale, 'es-ES');
  for (const bad of [{ autosave: false }, 'x', [1]]) assert.throws(() => labOptions(mount, bad), /solo admite/);
});
