/** GUI/web editing of the firewall: forms → nft text, reordering, templates, apply-and-save and boot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleFromForm, nftEdit, moveRule, NFT_TEMPLATES } from '../../src/net/nft/edit.ts';
import { runNft } from '../../src/net/nft/apply.ts';
import { EMPTY_RULESET } from '../../src/net/nft/model.ts';
import type { Ruleset } from '../../src/net/nft/model.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { applyAndSave, firewallStatus } from '../../src/shells/firewall-save.ts';
import { createShell } from '../../src/shells/factory.ts';

function edit(rs: Ruleset, cmd: string): Ruleset {
  const r = nftEdit(rs, cmd);
  if (!r.ok) assert.fail(r.error);
  return r.ruleset;
}

test('forms become nft rules that list exactly like the CLI', () => {
  assert.equal(ruleFromForm({ iif: 'eth1', saddr: '192.168.1.0/24', proto: 'tcp', dport: '22,80', ct: ['new'], counter: true, action: 'accept', comment: 'admin' }),
    'iifname "eth1" ip saddr 192.168.1.0/24 tcp dport { 22, 80 } ct state new counter accept comment "admin"');
  assert.equal(ruleFromForm({ oif: 'eth0', action: 'masquerade' }), 'oifname "eth0" masquerade');
  assert.equal(ruleFromForm({ proto: 'tcp', dport: '8080', action: 'dnat', to: '172.16.0.80:80' }), 'tcp dport 8080 dnat to 172.16.0.80:80');
  assert.equal(ruleFromForm({ proto: 'icmp', action: 'drop', log: 'ICMP ' }), 'ip protocol icmp log prefix "ICMP " drop');
  let rs = edit(EMPTY_RULESET, 'add table inet filter\nadd chain inet filter input { type filter hook input priority 0; policy drop; }');
  rs = edit(rs, `add rule inet filter input ${ruleFromForm({ proto: 'tcp', dport: '22', action: 'accept' }) as string}`);
  const cli = runNft(EMPTY_RULESET, 'add table inet filter\nadd chain inet filter input { type filter hook input priority 0; policy drop; }\nadd rule inet filter input tcp dport 22 accept');
  assert.ok(cli.ok);
  assert.deepEqual(runNft(rs, 'list ruleset').ok && runNft(rs, 'list ruleset'), cli.ok && runNft(cli.ruleset, 'list ruleset'));
});

test('invalid or injected form fields are refused', () => {
  assert.deepEqual(ruleFromForm({ iif: 'eth0" accept; flush ruleset; #', action: 'drop' }), { error: 'iif' });
  assert.deepEqual(ruleFromForm({ comment: 'x" drop', action: 'accept' }), { error: 'comment' });
  assert.deepEqual(ruleFromForm({ saddr: '10.0.0.300', action: 'accept' }), { error: 'saddr' });
  assert.deepEqual(ruleFromForm({ dport: '22', action: 'accept' }), { error: 'proto' }, 'a port needs tcp or udp');
  assert.deepEqual(ruleFromForm({ proto: 'udp', dport: '53;drop', action: 'accept' }), { error: 'dport' });
  assert.deepEqual(ruleFromForm({ action: 'dnat' }), { error: 'to' });
  assert.deepEqual(ruleFromForm({ ct: ['established', 'bogus'], action: 'accept' }), { error: 'ct' });
});

test('rules move up and down; templates are valid rulesets', () => {
  let rs = edit(EMPTY_RULESET, 'add table ip t\nadd chain ip t c\nadd rule ip t c tcp dport 1 accept\nadd rule ip t c tcp dport 2 accept');
  rs = moveRule(rs, 'ip', 't', 'c', 4, -1);
  const r = runNft(rs, 'list chain ip t c');
  assert.deepEqual(r.ok ? r.output.slice(2, 4) : [], ['\t\ttcp dport 2 accept', '\t\ttcp dport 1 accept']);
  assert.equal(moveRule(rs, 'ip', 't', 'c', 4, -1), rs, 'already first');
  for (const [name, text] of Object.entries(NFT_TEMPLATES)) assert.ok(runNft(EMPTY_RULESET, text).ok, name);
});

test('apply-and-save writes /etc/nftables.conf, enables nftables.service and survives a reload', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const r = runNft(EMPTY_RULESET, NFT_TEMPLATES.hardening ?? '');
  assert.ok(r.ok);
  if (!r.ok) return;
  applyAndSave(srv, r.ruleset);
  assert.deepEqual(firewallStatus(srv), { active: true, enabled: true, saved: true });
  const root = createShell(srv, 'linux', 'root');
  assert.match(root.run('cat /etc/nftables.conf').join('\n'), /^#!\/usr\/sbin\/nft -f\n\nflush ruleset\n\ntable inet filter \{\n\tchain input \{\n\t\ttype filter hook input priority filter; policy drop;/);
  assert.match(root.run('systemctl is-enabled nftables; systemctl is-active nftables').join('\n'), /enabled\nactive/);
  root.run('nft add rule inet filter input tcp dport 80 accept');
  assert.equal(firewallStatus(srv).saved, false, 'a CLI change is not saved');
  const t2 = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const srv2 = t2.get(srv.id)?.device as Server;
  const listed = runNft(srv2.kernel.netfilter.ruleset, 'list ruleset');
  assert.match(listed.ok ? listed.output.join('\n') : '', /tcp dport 22 accept/);
  assert.doesNotMatch(listed.ok ? listed.output.join('\n') : '', /dport 80/, 'the unsaved CLI rule is lost on reboot');
});
