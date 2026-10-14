/** Fixes from the v0.7 review: nft sets over several lines, chained defines, bounded includes, own-key lookups. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNft } from '../../src/net/nft/apply.ts';
import { EMPTY_RULESET } from '../../src/net/nft/model.ts';
import { parseYaml, MAX_YAML_LINE } from '../../src/core/yaml-lite.ts';
import { ruleFromForm } from '../../src/net/nft/edit.ts';
import type { RuleForm } from '../../src/net/nft/edit.ts';
import { hasMessage, tDynamic } from '../../src/i18n/t.ts';

test('a set may span several lines', () => {
  const r = runNft(EMPTY_RULESET, 'table inet f {\n  chain input {\n    type filter hook input priority 0;\n    tcp dport {\n      22,\n      80\n    } accept\n  }\n}');
  assert.ok(r.ok, r.ok ? '' : r.error);
});

test('a define may use an earlier define', () => {
  const r = runNft(EMPTY_RULESET, 'define LAN = 10.0.0.0/24\ndefine OK = { $LAN, 1.1.1.1 }\ntable ip t {\n  chain c {\n    ip saddr $OK accept\n  }\n}');
  assert.ok(r.ok, r.ok ? '' : r.error);
});

test('a file that includes itself many times stops instead of freezing', () => {
  const r = runNft(EMPTY_RULESET, 'include "/etc/self.nft"', { read: () => 'include "/etc/self.nft"\ninclude "/etc/self.nft"\ninclude "/etc/self.nft"' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /too many included files|nested too deeply/);
});

test('priority names and services are own keys only', () => {
  const r = runNft(EMPTY_RULESET, 'add table ip t\nadd chain ip t c { type filter hook input priority constructor; }');
  assert.equal(r.ok, false);
  assert.equal(hasMessage('toString'), false);
  assert.equal(tDynamic('constructor'), 'constructor');
});

test('YAML refuses huge lines and the __proto__ key', () => {
  assert.match(JSON.stringify(parseYaml(`a${' '.repeat(MAX_YAML_LINE)}x`)), /line too long/);
  assert.match(JSON.stringify(parseYaml('__proto__:\n  x: 1')), /invalid key/);
});

test('rule forms are validated at run time too', () => {
  const bad = { action: 'accept; flush ruleset' } as unknown as RuleForm;
  assert.deepEqual(ruleFromForm(bad), { error: 'action' });
  assert.deepEqual(ruleFromForm({ action: 'drop', proto: 'gre' } as unknown as RuleForm), { error: 'proto' });
});
