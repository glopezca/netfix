/** nftables language: commands, files, listing (literal nft 1.1 output), errors and limits. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNft, rulesetFile } from '../../src/net/nft/apply.ts';
import { EMPTY_RULESET } from '../../src/net/nft/model.ts';
import type { Ruleset } from '../../src/net/nft/model.ts';

function run(rs: Ruleset, src: string): Ruleset {
  const r = runNft(rs, src);
  if (!r.ok) assert.fail(`${src}\n${r.error}`);
  return r.ruleset;
}

function list(rs: Ruleset, src = 'list ruleset', handles = false): string {
  const r = runNft(rs, src, { format: { handles } });
  assert.ok(r.ok);
  return r.ok ? r.output.join('\n') : '';
}

test('commands build a ruleset that lists like nft 1.1', () => {
  let rs = run(EMPTY_RULESET, 'add table inet filter');
  rs = run(rs, 'add chain inet filter input { type filter hook input priority 0; policy drop; }');
  rs = run(rs, 'add rule inet filter input ct state established,related accept');
  rs = run(rs, 'add rule inet filter input iif lo accept');
  rs = run(rs, 'add rule inet filter input ip saddr 192.168.10.0/24 tcp dport { 22, http } counter accept');
  rs = run(rs, 'add rule inet filter input icmp type echo-request limit_free accept'.replace(' limit_free', ''));
  assert.equal(list(rs), [
    'table inet filter {',
    '\tchain input {',
    '\t\ttype filter hook input priority filter; policy drop;',
    '\t\tct state established,related accept',
    '\t\tiif "lo" accept',
    '\t\tip saddr 192.168.10.0/24 tcp dport { 22, 80 } counter packets 0 bytes 0 accept',
    '\t\ticmp type echo-request accept',
    '\t}',
    '}',
  ].join('\n'));
  assert.match(list(rs, 'list ruleset', true), /^table inet filter \{ # handle 1\n\tchain input \{ # handle 2\n[\s\S]*ct state established,related accept # handle 3\n/);
});

test('comment after the verdict round-trips', () => {
  const rs = run(EMPTY_RULESET, 'add table ip t\nadd chain ip t c\nadd rule ip t c tcp dport 22 counter accept comment "ssh admin"');
  assert.match(list(rs), /tcp dport 22 counter packets 0 bytes 0 accept comment "ssh admin"/);
  assert.equal(list(run(EMPTY_RULESET, list(rs))), list(rs));
  assert.equal(runNft(EMPTY_RULESET, 'add table ip t\nadd chain ip t c\nadd rule ip t c accept drop').ok, false, 'two verdicts');
});

test('insert, position, replace and delete by handle', () => {
  let rs = run(EMPTY_RULESET, 'add table ip t\nadd chain ip t c');
  rs = run(rs, 'add rule ip t c tcp dport 22 accept');
  rs = run(rs, 'insert rule ip t c tcp dport 80 accept');
  rs = run(rs, 'add rule ip t c position 4 udp dport 53 accept');
  assert.deepEqual(list(rs, 'list chain ip t c').split('\n').slice(2, 5), ['\t\ttcp dport 80 accept', '\t\tudp dport 53 accept', '\t\ttcp dport 22 accept']);
  rs = run(rs, 'replace rule ip t c handle 3 tcp dport 2222 drop');
  rs = run(rs, 'delete rule ip t c handle 4');
  assert.deepEqual(list(rs, 'list chain ip t c').split('\n').slice(2, 4), ['\t\tudp dport 53 accept', '\t\ttcp dport 2222 drop']);
});

test('rule files: flush ruleset, table blocks, define, comments, nat chains', () => {
  const file = `#!/usr/sbin/nft -f
flush ruleset
define LAN = 192.168.1.0/24
define WAN = "eth0"

table ip nat {
	chain postrouting {
		type nat hook postrouting priority srcnat; policy accept;
		ip saddr $LAN oifname $WAN masquerade   # salida a Internet
	}
	chain prerouting {
		type nat hook prerouting priority dstnat;
		iifname $WAN tcp dport 8080 dnat to 192.168.1.10:80
	}
}`;
  const rs = run(run(EMPTY_RULESET, 'add table inet old'), file);
  assert.equal(list(rs), [
    'table ip nat {',
    '\tchain postrouting {',
    '\t\ttype nat hook postrouting priority srcnat; policy accept;',
    '\t\tip saddr 192.168.1.0/24 oifname "eth0" masquerade',
    '\t}',
    '',
    '\tchain prerouting {',
    '\t\ttype nat hook prerouting priority dstnat; policy accept;',
    '\t\tiifname "eth0" tcp dport 8080 dnat to 192.168.1.10:80',
    '\t}',
    '}',
  ].join('\n'));
  // The generated file reads back to the same ruleset.
  assert.equal(list(run(EMPTY_RULESET, rulesetFile(rs))), list(rs));
});

test('errors are printed like nft, with the line and carets, and nothing is applied', () => {
  const r = runNft(EMPTY_RULESET, 'add rule inet filter input tcp dport 22 accept');
  assert.equal(r.ok ? '' : r.error, 'Error: Could not process rule: No such file or directory\nadd rule inet filter input tcp dport 22 accept\n              ^^^^^^');
  const s = runNft(EMPTY_RULESET, 'add table inet t\nadd chain inet t c\nadd rule inet t c tcp dprt 22 accept');
  assert.equal(s.ok ? '' : s.error, 'Error: syntax error, unexpected tcp\nadd rule inet t c tcp dprt 22 accept\n                  ^^^');
  const base = run(EMPTY_RULESET, 'add table inet f\nadd chain inet f input { type filter hook input priority 0; }');
  assert.match(runNft(base, 'add rule inet f input masquerade').ok ? '' : 'x', /x/, 'masquerade only in nat chains');
  assert.match(runNft(base, 'add rule inet f input jump nowhere').ok ? '' : 'x', /x/);
  assert.match(runNft(base, 'add rule inet f input tcp dport 99999 accept').ok ? '' : 'x', /x/);
  const busy = run(base, 'add rule inet f input accept');
  const del = runNft(busy, 'delete chain inet f input');
  assert.match(del.ok ? '' : del.error, /Device or resource busy/);
  assert.match(runNft(EMPTY_RULESET, 'add table ip6 t').ok ? '' : 'x', /x/);
});

test('atomic files, include, priorities by name and limits', () => {
  const half = runNft(EMPTY_RULESET, 'add table ip a\nadd rule ip a nochain accept');
  assert.equal(half.ok, false);
  const files: Record<string, string> = { '/etc/nft.d/a.nft': 'table ip a { chain c { type filter hook forward priority filter + 10; } }' };
  const rs = runNft(EMPTY_RULESET, 'include "/etc/nft.d/a.nft"', { read: (p) => files[p] ?? null });
  assert.ok(rs.ok);
  assert.match(rs.ok ? list(rs.ruleset) : '', /type filter hook forward priority filter \+ 10; policy accept;/);
  const loop = runNft(EMPTY_RULESET, 'include "/x"', { read: () => 'include "/x"' });
  assert.match(loop.ok ? '' : loop.error, /Include nested too deeply/);
  const big = `{ ${Array.from({ length: 300 }, (_, i) => i + 1).join(', ')} }`;
  const tooBig = runNft(run(EMPTY_RULESET, 'add table ip t\nadd chain ip t c'), `add rule ip t c tcp dport ${big} accept`);
  assert.match(tooBig.ok ? '' : tooBig.error, /set too large/);
});
