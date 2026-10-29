/** Per-lab device features (Configuración → Laboratorio actual): defaults, changes, untrusted JSON, file round trip. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureOn, featuresOf, setFeature, parseFeatures, FEATURES_BY_KIND } from '../../src/net/lab-features.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';

test('defaults: everything allowed but the Windows terminal of the GNU/Linux router (each device then decides)', () => {
  const none = {};
  assert.deepEqual(featuresOf(none, 'pc'), ['ip', 'apps', 'linux', 'windows']);
  assert.deepEqual(featuresOf(none, 'server'), ['ip', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'sysctl', 'firewall', 'linux', 'windows']);
  assert.deepEqual(featuresOf(none, 'linuxrouter'), ['sysctl', 'firewall', 'vpn', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'linux']);
  assert.deepEqual(featuresOf(none, 'router'), ['cli', 'web']);
  assert.equal(featureOn(none, 'server', 'firewall'), true);
  assert.equal(featureOn(none, 'linuxrouter', 'windows'), false);
  assert.deepEqual(FEATURES_BY_KIND.server, ['ip', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'sysctl', 'firewall', 'linux', 'windows'], 'each service on its own');
});

test('a change keeps only what differs from the defaults, and a feature a kind lacks is ignored', () => {
  let f = setFeature({}, 'server', 'firewall', false);
  assert.deepEqual(f, { server: ['ip', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'sysctl', 'linux', 'windows'] });
  f = setFeature(f, 'pc', 'windows', false);
  assert.equal(featureOn(f, 'pc', 'windows'), false);
  f = setFeature(f, 'server', 'firewall', true);
  assert.deepEqual(Object.keys(f), ['pc'], 'back to the default: the server entry goes away');
  assert.deepEqual(setFeature({}, 'pc', 'firewall', true), {}, 'a PC has no firewall panel');
});

test('untrusted JSON: unknown kinds, unknown features and wrong types are dropped', () => {
  assert.deepEqual(parseFeatures({ pc: ['linux', 'nope', 7], toaster: ['linux'], server: 'firewall', router: ['cli'] }), { pc: ['linux'], router: ['cli'] });
  assert.deepEqual(parseFeatures('x'), {});
  assert.deepEqual(parseFeatures(null), {});
  assert.deepEqual(parseFeatures({ pc: Array.from({ length: 50 }, () => 'linux') }), { pc: ['linux'] }, 'repeated entries collapse');
  assert.deepEqual(parseFeatures({ pc: Array.from({ length: 500 }, () => 'linux') }), {}, 'an absurdly long list is ignored');
  assert.deepEqual(parseFeatures({ pc: ['ip', 'apps', 'linux', 'windows'] }), {}, 'a list equal to the defaults is not kept');
  assert.deepEqual(parseFeatures(JSON.parse('{"__proto__": ["linux"], "constructor": ["linux"]}')), {});
});

test('the lab settings travel with the topology file', () => {
  const t = EXAMPLES[0]!.build();
  assert.equal(t.toJSON().features, undefined, 'nothing saved while everything is as default');
  t.features = setFeature(t.features, 'pc', 'windows', false);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(featureOn(again.features, 'pc', 'windows'), false);
  assert.equal(featureOn(again.features, 'pc', 'linux'), true);
});

test('recorded labs limit nothing in the lab settings (each device shows what it runs: lab-devices.test.ts)', () => {
  for (const ex of EXAMPLES) assert.deepEqual(ex.build().features, {}, ex.id);
  assert.deepEqual(new Topology().features, {}, 'Nuevo: the defaults');
});
