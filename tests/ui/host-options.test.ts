import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOptionNames, kindOffered, registerHostOption, startKindHosts } from '../../src/ui/host-options.ts';
import { labOptions, takeHostOptions } from '../../src/ui/embed-api.ts';

const mount = {} as HTMLElement;

// A fake extension: a "beacon" kind whose host gives a channel number.
registerHostOption('beaconChannel', {
  kind: 'beacon',
  parse: (v) => {
    if (typeof v !== 'number' || v < 1) throw new Error('netfix: «beaconChannel» debe ser un número');
    return v;
  },
  start: (channel: number | null) => ({ offered: channel !== null, context: channel }),
});

test('an extension adds its host option to netfix.embed and netfix.lab, validated by it', () => {
  assert.ok(hostOptionNames().includes('beaconChannel'));
  const { rest, host } = takeHostOptions(mount, { beaconChannel: 7, restrictions: {} });
  assert.deepEqual({ ...rest as object }, { restrictions: {} }, 'the option is taken out of what embed reads');
  assert.equal(host.extensions.beaconChannel, 7);
  assert.equal(labOptions(mount, { beaconChannel: 2 }).extensions.beaconChannel, 2);
  assert.throws(() => takeHostOptions(mount, { beaconChannel: 'x' }), /beaconChannel/);
  assert.throws(() => labOptions(mount, { other: 1 }), /beaconChannel/, 'the error lists the extension options too');
});

test('each mount starts a kind host per registered option, given or not', () => {
  const given = startKindHosts({ beaconChannel: 5 }).get('beacon');
  assert.deepEqual([given?.offered, given?.context], [true, 5]);
  const absent = startKindHosts({}).get('beacon');
  assert.deepEqual([absent?.offered, absent?.context], [false, null]);
});

test('an option cannot take a built-in name, a taken name or a kind that already has one', () => {
  const spec = { kind: 'other', parse: (v: unknown) => v, start: () => ({ offered: true, context: null }) };
  for (const name of ['toolbar', 'topology', 'Bad', 'a-b']) assert.throws(() => registerHostOption(name, spec), /no puede/);
  assert.throws(() => registerHostOption('beaconChannel', spec), /ya está registrada/);
  assert.throws(() => registerHostOption('beacon2', { ...spec, kind: 'beacon' }), /ya tiene opción/);
});

test('the palette offers a kind with a host option only when this mount was given it', () => {
  startKindHosts({});
  assert.equal(kindOffered('beacon'), false);
  startKindHosts({ beaconChannel: 1 });
  assert.equal(kindOffered('beacon'), true);
  assert.equal(kindOffered('pc'), true, 'a kind without a host option is not affected');
});
