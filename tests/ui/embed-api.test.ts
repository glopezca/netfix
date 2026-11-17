import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMount, labToolbar, takeToolbar } from '../../src/ui/embed-api.ts';

test('netfix.embed needs an element to mount on', () => {
  assert.throws(() => checkMount('#app'), /elemento/);
  assert.throws(() => checkMount(undefined), /elemento/);
});

test('toolbar option: none leaves the options as they were; anything but a page element is refused', () => {
  const mount = {} as HTMLElement;
  const options = { restrictions: {} };
  assert.deepEqual(takeToolbar(mount, options), { rest: options, toolbar: null });
  assert.deepEqual(takeToolbar(mount, undefined), { rest: undefined, toolbar: null });
  assert.throws(() => takeToolbar(mount, { toolbar: '#bar' }), /toolbar/);
});

test('netfix.lab takes no option but toolbar', () => {
  const mount = {} as HTMLElement;
  assert.equal(labToolbar(mount, undefined), null);
  assert.equal(labToolbar(mount, {}), null);
  assert.throws(() => labToolbar(mount, { autosave: false }), /única opción/);
  assert.throws(() => labToolbar(mount, 'x'), /única opción/);
  assert.throws(() => labToolbar(mount, [1]), /única opción/);
});
