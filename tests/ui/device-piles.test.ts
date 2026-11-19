/** Palette piles: off by default; a host can turn them on; the settings box keeps them in this browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicePiles, onDevicePiles, overrideDevicePiles, setDevicePiles } from '../../src/ui/preferences.ts';
import { choosePcSystem } from '../../src/net/device-apps.ts';

test('device piles are off by default, a host turns them on, the setting tells the palette', () => {
  overrideDevicePiles(undefined);
  assert.equal(devicePiles(), false, 'off unless turned on');
  overrideDevicePiles(true);
  assert.equal(devicePiles(), true, 'the host\'s choice');
  let told = 0;
  const stop = onDevicePiles(() => { told++; });
  setDevicePiles(false);
  assert.equal(devicePiles(), false, 'the box wins for the session');
  assert.equal(told, 1, 'the palette redraws');
  stop();
  overrideDevicePiles(undefined);
});

test('a PC picked from its pile gets that system without the question', () => {
  const pc = { kind: 'pc' as const, os: 'windows' as 'linux' | 'windows' };
  choosePcSystem(pc, 'linux');
  assert.equal(pc.os, 'linux');
});

test('a pile\'s menu floats beside its button in a column palette, above it in a row, and stays on screen', async () => {
  const { pileMenuAt } = await import('../../src/ui/palette.ts');
  const view = { width: 1000, height: 800 };
  const menu = { width: 150, height: 200 };
  assert.deepEqual(pileMenuAt({ left: 10, top: 100, right: 140 }, menu, true, view), { left: 144, top: 100 }, 'beside, top aligned');
  assert.deepEqual(pileMenuAt({ left: 10, top: 700, right: 140 }, menu, true, view), { left: 144, top: 600 }, 'pulled up to fit');
  assert.deepEqual(pileMenuAt({ left: 300, top: 740, right: 380 }, menu, false, view), { left: 300, top: 536 }, 'above the bottom palette');
  assert.deepEqual(pileMenuAt({ left: 950, top: 740, right: 1000 }, menu, false, view), { left: 850, top: 536 }, 'pulled left to fit');
});
