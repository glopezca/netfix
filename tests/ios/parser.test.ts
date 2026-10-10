import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrie, matchLine, helpFor, completeToken, expandSyntax, tokenize } from '../../src/ios/parser.ts';
import type { CommandDef } from '../../src/ios/parser.ts';

const calls: string[] = [];
const defs: CommandDef<null>[] = [
  { syntax: 'ip dhcp pool <WORD:name>', run: (_c, m) => calls.push(`pool ${m.get('name')}`) },
  { syntax: 'ip dhcp excluded-address <A.B.C.D:low> [<A.B.C.D:high>]', run: (_c, m) => calls.push(`excl ${m.get('low')} ${m.get('high') ?? '-'}`) },
  { syntax: 'ip domain-name <WORD:d>', run: () => calls.push('dn') },
  { syntax: 'ip domain-lookup', run: () => calls.push('dl') },
  { syntax: 'lease {<0-365:days> [<0-23:hours> [<0-59:mins>]] | infinite}', run: (_c, m) => calls.push(`lease ${m.has('infinite') ? 'inf' : m.get('days')}/${m.get('hours') ?? ''}`) },
  { syntax: 'default-router <A.B.C.D...:r>', run: (_c, m) => calls.push(`dr ${m.all('r').join(',')}`) },
  { syntax: 'banner motd <LINE:text>', run: (_c, m) => calls.push(`banner ${m.get('text')}`) },
  { syntax: 'network <A.B.C.D:net> [<MASK:mask>]', run: (_c, m) => calls.push(`net ${m.get('net')} ${m.get('mask') ?? ''}`), noRun: () => calls.push('no net') },
  { syntax: 'hardware-address <H.H.H:mac> [<HWTYPE:type>]', run: (_c, m) => calls.push(`hw ${m.get('mac')} ${m.get('type') ?? ''}`) },
  { syntax: 'client-identifier <HEX:id>', run: (_c, m) => calls.push(`cid ${m.get('id')}`) },
];
const help = { ip: 'Global IP configuration subcommands', dhcp: 'Configure DHCP server and relay parameters', pool: 'Configure DHCP address pools' };
const trie = buildTrie(defs, help);

function run(line: string): string {
  calls.length = 0;
  const result = matchLine(trie, line, false);
  if (result.kind !== 'ok') return result.kind;
  result.def.run(null, result.match);
  return calls.join('|');
}

test('expandSyntax expands optional and alternative groups', () => {
  assert.equal(expandSyntax('a [b [c]]').length, 3);
  assert.equal(expandSyntax('a {b | c d}').length, 2);
  assert.equal(expandSyntax('x <A.B.C.D...:r>').length, 8);
});

test('tokenize keeps offsets', () => {
  assert.deepEqual(tokenize('  ip  dhcp'), [{ text: 'ip', start: 2 }, { text: 'dhcp', start: 6 }]);
});

test('matches full and abbreviated keywords', () => {
  assert.equal(run('ip dhcp pool LAN'), 'pool LAN');
  assert.equal(run('ip dh po LAN'), 'pool LAN');
  assert.equal(run('IP DHCP EXCLUDED-ADDRESS 10.0.0.1 10.0.0.9'), 'excl 10.0.0.1 10.0.0.9');
  assert.equal(run('ip dhcp ex 10.0.0.1'), 'excl 10.0.0.1 -');
});

test('reports ambiguous, incomplete and invalid input with position', () => {
  assert.equal(matchLine(trie, 'ip do', false).kind, 'ambiguous');
  assert.equal(matchLine(trie, 'ip dhcp', false).kind, 'incomplete');
  const bad = matchLine(trie, 'ip dhcp pxx', false);
  assert.equal(bad.kind, 'invalid');
  assert.equal(bad.kind === 'invalid' ? bad.position : -1, 8);
  const badIp = matchLine(trie, 'ip dhcp excluded-address 300.1.1.1', false);
  assert.equal(badIp.kind === 'invalid' ? badIp.position : -1, 25);
});

test('handles ranges, alternatives and repeated params', () => {
  assert.equal(run('lease 2 12'), 'lease 2/12');
  assert.equal(run('lease inf'), 'lease inf/');
  assert.equal(matchLine(trie, 'lease 400', false).kind, 'invalid');
  assert.equal(run('default-router 10.0.0.1 10.0.0.2 10.0.0.3'), 'dr 10.0.0.1,10.0.0.2,10.0.0.3');
  assert.equal(run('banner motd #Hola mundo#'), 'banner #Hola mundo#');
});

test('validates MAC, mask, hardware type and hex params', () => {
  assert.equal(run('network 10.0.0.0 /8'), 'net 10.0.0.0 /8');
  assert.equal(run('network 10.0.0.0 255.0.0.0'), 'net 10.0.0.0 255.0.0.0');
  assert.equal(matchLine(trie, 'network 10.0.0.0 255.0.255.0', false).kind, 'invalid');
  assert.equal(run('hardware-address 0011.2233.4455 ieee802'), 'hw 0011.2233.4455 ieee802');
  assert.equal(run('hardware-address 0011.2233.4455 1'), 'hw 0011.2233.4455 1');
  assert.equal(matchLine(trie, 'hardware-address 0011.2233', false).kind, 'invalid');
  assert.equal(run('client-identifier 0100.1122.3344.55'), 'cid 0100.1122.3344.55');
});

test('no-form uses noRun and accepts the keyword prefix only', () => {
  const noTrie = buildTrie(defs, help, true);
  const r = matchLine(noTrie, 'network', false);
  assert.equal(r.kind, 'ok');
  calls.length = 0;
  if (r.kind === 'ok') r.def.noRun?.(null, r.match);
  assert.deepEqual(calls, ['no net']);
});

test('help lists children with descriptions and <cr>', () => {
  const lines = helpFor(trie, 'ip dhcp ');
  assert.ok(lines.some((l) => l.includes('pool') && l.includes('Configure DHCP address pools')));
  assert.ok(lines.some((l) => l.includes('excluded-address')));
  const withCr = helpFor(trie, 'ip dhcp excluded-address 1.1.1.1 ');
  assert.ok(withCr.some((l) => l.includes('<cr>')));
  assert.ok(withCr.some((l) => l.includes('A.B.C.D')));
  assert.deepEqual(helpFor(trie, 'ip do'), ['domain-lookup  domain-name']);
  assert.deepEqual(helpFor(trie, 'zz '), ['% Unrecognized command']);
});

test('tab completion completes unique keyword prefixes', () => {
  assert.equal(completeToken(trie, 'ip dh'), 'ip dhcp ');
  assert.equal(completeToken(trie, 'ip do'), null);
  assert.equal(completeToken(trie, 'ip dhcp ex'), 'ip dhcp excluded-address ');
});
