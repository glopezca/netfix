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
