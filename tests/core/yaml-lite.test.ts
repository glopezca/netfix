/** YAML subset used by netplan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, isYamlError } from '../../src/core/yaml-lite.ts';

test('netplan-style documents: mappings, sequences, flow lists, quotes and comments', () => {
  const doc = parseYaml(`# comment
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false   # static
      addresses:
        - 192.168.1.10/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, "1.1.1.1"]
`);
  assert.deepEqual(doc, { network: { version: '2', ethernets: { eth0: {
    dhcp4: 'false', addresses: ['192.168.1.10/24'], routes: [{ to: 'default', via: '192.168.1.1' }], nameservers: { addresses: ['8.8.8.8', '1.1.1.1'] },
  } } } });
});

test('sequences at the same indentation as their key are accepted', () => {
  assert.deepEqual(parseYaml('a:\n- x\n- y\nb: 1'), { a: ['x', 'y'], b: '1' });
});

test('errors carry line and column', () => {
  const bad = parseYaml('network:\n  version: 2\n    ethernets: x');
  assert.ok(isYamlError(bad));
  assert.equal(bad.line, 3);
  const tab = parseYaml('a:\n\tb: 1');
  assert.ok(isYamlError(tab) && /tabs/.test(tab.message));
  assert.ok(isYamlError(parseYaml('a: {b: 1}')));
  assert.ok(isYamlError(parseYaml('a: 1\na: 2')));
  assert.ok(isYamlError(parseYaml('just text')));
  assert.ok(isYamlError(parseYaml('x\n'.repeat(500))));
  assert.deepEqual(parseYaml(''), {});
});
