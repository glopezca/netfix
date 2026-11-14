/** Characterization: validateFile called directly (until now only reached through Topology.fromJSON). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFile, FILE_VERSION, MAX_DEVICES } from '../../src/net/topology-file.ts';
import { EXAMPLES } from '../../src/net/examples.ts';

const dev = (i: number): object => ({ id: `d${i}`, kind: 'pc', x: 0, y: 0, seed: i, label: `P${i}` });
const file = (over: object = {}): Record<string, unknown> => ({ format: 'netfix', version: FILE_VERSION, devices: [], links: [], ...over });

test('format and version: netfix and netsim, versions 1 and 2', () => {
  assert.equal(FILE_VERSION, 2);
  for (const format of ['netfix', 'netsim']) for (const version of [1, 2]) assert.doesNotThrow(() => validateFile(file({ format, version })), `${format} v${version}`);
  for (const bad of [null, 'x', file({ format: 'otro' }), file({ version: 3 }), file({ version: undefined })]) assert.throws(() => validateFile(bad), /No es un archivo de Netfix válido\./);
  assert.deepEqual(validateFile(file()).annotations, []);
});

test('devices and links must be arrays, and no more than MAX_DEVICES devices (2x links)', () => {
  assert.equal(MAX_DEVICES, 500);
  assert.throws(() => validateFile(file({ devices: {} })), /Archivo incompleto: faltan dispositivos o enlaces\./);
  assert.doesNotThrow(() => validateFile(file({ devices: Array.from({ length: MAX_DEVICES }, (_, i) => dev(i)) })));
  assert.throws(() => validateFile(file({ devices: Array.from({ length: MAX_DEVICES + 1 }, (_, i) => dev(i)) })), /demasiados dispositivos o enlaces \(máximo 500\)/);
  assert.throws(() => validateFile(file({ links: new Array(MAX_DEVICES * 2 + 1).fill({}) })), /demasiados/);
});

test('bad devices and links are refused with their message', () => {
  assert.throws(() => validateFile(file({ devices: [{ ...dev(1), kind: 'toaster' }] })), /Dispositivo no válido en el archivo\./);
  assert.throws(() => validateFile(file({ devices: [{ ...dev(1), x: 'a' }] })), /Datos incompletos para d1\./);
  assert.throws(() => validateFile(file({ devices: [{ ...dev(1), label: 'x'.repeat(65) }] })), /Datos incompletos para d1\./);
  assert.throws(() => validateFile(file({ devices: [{ ...dev(1), config: [1] }] })), /d1/);
  assert.throws(() => validateFile(file({ links: [{ a: { device: 'd1', port: 'p' }, b: {} }] })), /Enlace no válido en el archivo\./);
});

test('every lab file validates and keeps its devices', () => {
  for (const ex of EXAMPLES) {
    const f = ex.build().toJSON();
    assert.equal(validateFile(f).devices.length, f.devices.length, ex.id);
  }
});
