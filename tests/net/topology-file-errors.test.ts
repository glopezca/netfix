/** Typed format errors: `code` is the contract, the message stays the translated text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFile, TopologyFileError, FILE_VERSION, MAX_DEVICES } from '../../src/net/topology-file.ts';
import type { TopologyFileErrorCode } from '../../src/net/topology-file.ts';
import { Topology } from '../../src/net/topology.ts';

const dev = (over: object = {}): object => ({ id: 'd1', kind: 'pc', x: 0, y: 0, seed: 1, label: 'P1', ...over });
const file = (over: object = {}): Record<string, unknown> => ({ format: 'netfix', version: FILE_VERSION, devices: [], links: [], ...over });
const link = (over: object = {}): object => ({ a: { device: 'd1', port: 'eth0' }, b: { device: 'd2', port: 'eth0' }, ...over });

const cases: Array<[TopologyFileErrorCode, unknown, RegExp]> = [
  ['not-netfix', file({ version: 3 }), /No es un archivo de Netfix válido\./],
  ['incomplete', file({ devices: {} }), /Archivo incompleto/],
  ['too-big', file({ devices: new Array(MAX_DEVICES + 1).fill(dev()) }), /demasiados dispositivos o enlaces \(máximo 500\)/],
  ['bad-device', file({ devices: [dev({ kind: 'toaster' })] }), /./],
  ['device-data', file({ devices: [dev({ x: 'a' })] }), /d1/],
  ['device-config', file({ devices: [dev({ config: [1] })] }), /d1/],
  ['bad-link', file({ devices: [dev()], links: [link({ b: {} })] }), /./],
  ['drawings', file({ annotations: 'x' }), /./],
];

for (const [code, input, message] of cases) {
  test(`${code}: validateFile and Topology.fromJSON throw TopologyFileError`, () => {
    for (const run of [() => validateFile(input), () => Topology.fromJSON(input)]) {
      assert.throws(run, (e: unknown) => e instanceof TopologyFileError && e instanceof Error && e.code === code && message.test(e.message));
    }
  });
}

test('every code of the union is covered', () => {
  assert.equal(new Set(cases.map((c) => c[0])).size, 8);
});
