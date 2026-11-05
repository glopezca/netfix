/**
 * /etc/systemd/resolved.conf and the systemd-resolved unit (v0.35): the file is read as systemd does (sections, later
 * assignments win, warnings in the journal) only when the unit starts or the host boots, so an edit needs a restart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseResolvedConf, RESOLVED_CONF } from '../../src/shells/resolved-conf.ts';
import { resolvedConfig } from '../../src/shells/resolved.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));

test('the parser: [Resolve] only, the last assignment wins, systemd booleans and «resolve»', () => {
  assert.deepEqual(parseResolvedConf(''), { llmnr: 'no', mdns: 'no', warnings: [] });
  const c = parseResolvedConf('# comment\n; other\n[Resolve]\nLLMNR=yes\n  MulticastDNS = resolve  \nLLMNR=off\n');
  assert.equal(c.llmnr, 'no');
  assert.equal(c.mdns, 'resolve');
  assert.deepEqual(c.warnings, []);
  for (const v of ['1', 'YES', 'y', 'True', 't', 'on']) assert.equal(parseResolvedConf(`[Resolve]\nLLMNR=${v}`).llmnr, 'yes', v);
  assert.equal(parseResolvedConf('[Resolve]\nLLMNR=Resolve').llmnr, 'no', '«resolve» is not a boolean: only lower case');
});

test('the parser: what systemd warns about and ignores', () => {
  const c = parseResolvedConf('LLMNR=yes\n[Resolve]\nLLMNR=maybe\nFoo=1\nnoequals\nllmnr=yes\n[Other]\nMulticastDNS=yes\n');
  assert.equal(c.llmnr, 'no');
  assert.equal(c.mdns, 'no');
  assert.deepEqual(c.warnings, [
    `${RESOLVED_CONF}:1: Assignment outside of section. Ignoring.`,
    `${RESOLVED_CONF}:3: Failed to parse LLMNR=maybe, ignoring.`,
    `${RESOLVED_CONF}:4: Unknown key 'Foo' in section [Resolve], ignoring.`,
    `${RESOLVED_CONF}:5: Missing '=', ignoring line.`,
    `${RESOLVED_CONF}:6: Unknown key 'llmnr' in section [Resolve], ignoring.`,
    `${RESOLVED_CONF}:7: Unknown section 'Other'. Ignoring.`,
  ]);
});

test('a huge or hostile file is cut: few warnings, short lines, quick', () => {
  const started = Date.now();
  const c = parseResolvedConf(`[Resolve]\n${'Bogus=1\n'.repeat(10_000)}LLMNR=yes\n`);
  assert.ok(Date.now() - started < 500);
  assert.ok(c.warnings.length <= 32, `${c.warnings.length} warnings`);
  assert.equal(c.llmnr, 'no', 'past the line limit nothing is read');
  const long = parseResolvedConf(`[Resolve]\nLLMNR=${'y'.repeat(100_000)}`);
  assert.ok((long.warnings[0]?.length ?? 0) < 5000);
});

test('Ubuntu ships the file with the compile-time defaults commented out', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  const text = run(pc, `cat ${RESOLVED_CONF}`);
  assert.match(text, /^\[Resolve\]$/m);
  assert.match(text, /^#MulticastDNS=no$/m);
  assert.match(text, /^#LLMNR=no$/m);
  assert.deepEqual(resolvedConfig(pc), { llmnr: 'no', mdns: 'no', warnings: [] });
});

test('systemd-resolved is a unit of every GNU/Linux host, running and enabled', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  const st = run(pc, 'systemctl status systemd-resolved');
  assert.match(st, /^● systemd-resolved\.service - Network Name Resolution\n {5}Loaded: loaded \(\/usr\/lib\/systemd\/system\/systemd-resolved\.service; enabled; preset: enabled\)\n {5}Active: active \(running\)/);
  assert.match(st, /Main PID: 512 \(systemd-resolve\)/, 'the kernel cuts the process name at 15 characters');
  assert.match(st, /└─512 \/usr\/lib\/systemd\/systemd-resolved$/m);
  assert.equal(run(pc, 'systemctl is-enabled systemd-resolved.service'), 'enabled');
  assert.match(run(pc, 'systemctl list-units'), /systemd-resolved\.service +loaded active +running Network Name Resolution/);
  assert.match(run(pc, 'systemctl restart systemd-resolved 2>&1', 'alumno'), /Interactive authentication required/);
});

test('an edit does nothing until the unit is restarted; the journal says what it read', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, `sed -i 's/^#LLMNR=no/LLMNR=yes/; s/^#MulticastDNS=no/MulticastDNS=resolve/' ${RESOLVED_CONF}`);
  assert.equal(resolvedConfig(pc).llmnr, 'no');
  run(pc, 'systemctl restart systemd-resolved');
  assert.equal(resolvedConfig(pc).llmnr, 'yes');
  assert.equal(resolvedConfig(pc).mdns, 'resolve');
  const log = run(pc, 'journalctl -u systemd-resolved');
  assert.match(log, /systemd\[1\]: Starting systemd-resolved\.service - Network Name Resolution\.\.\./);
  assert.match(log, /systemd-resolved\[512\]: Positive Trust Anchors:\n.*systemd-resolved\[512\]: \. IN DS 20326 8 2 /);
  assert.match(log, /systemd-resolved\[512\]: Using system hostname 'pc1'\.\n.*systemd\[1\]: Started systemd-resolved\.service - Network Name Resolution\.$/);
  run(pc, `sed -i 's/^LLMNR=yes/LLMNR=maybe/' ${RESOLVED_CONF}; systemctl restart systemd-resolved`);
  assert.equal(resolvedConfig(pc).llmnr, 'no', 'an invalid value leaves the default');
  assert.match(run(pc, 'journalctl -u systemd-resolved -n 50'), /systemd-resolved\[512\]: \/etc\/systemd\/resolved\.conf:\d+: Failed to parse LLMNR=maybe, ignoring\./);
});

test('stop and start; the state and the file survive a save and load', () => {
  const t = lab('internet');
  const pc = t.byLabel('PC1') as Host;
  run(pc, 'systemctl stop systemd-resolved');
  assert.equal(run(pc, 'systemctl is-active systemd-resolved'), 'inactive');
  assert.match(run(pc, 'systemctl status systemd-resolved; echo "status $?"'), /Active: inactive \(dead\)[\s\S]*status 3$/);
  run(pc, 'systemctl start systemd-resolved');
  assert.equal(run(pc, 'systemctl is-active systemd-resolved'), 'active');
  run(pc, `printf '[Resolve]\\nMulticastDNS=yes\\n' > ${RESOLVED_CONF}; systemctl stop systemd-resolved`);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON()))).byLabel('PC1') as Host;
  assert.equal(resolvedConfig(again).mdns, 'yes', 'the boot reads the saved file');
  assert.equal(run(again, 'systemctl is-active systemd-resolved'), 'inactive');
  const fresh = Topology.fromJSON(JSON.parse(JSON.stringify(lab('internet').toJSON()))).byLabel('PC1') as Host;
  assert.equal(run(fresh, 'systemctl is-active systemd-resolved'), 'active', 'a file without units: running, as always');
});

interface SavedPc { readonly label: string; readonly pc?: { files?: Record<string, unknown>[] } }

/** A saved topology whose PC1 has these records for resolved.conf (after the ones it already had). */
function loadWith(records: readonly Record<string, unknown>[]): Host {
  const json = JSON.parse(JSON.stringify(lab('internet').toJSON())) as { devices: SavedPc[] };
  const pc = json.devices.find((d) => d.label === 'PC1');
  if (pc?.pc) pc.pc.files = [...(pc.pc.files ?? []), ...records];
  return Topology.fromJSON(json).byLabel('PC1') as Host;
}

const record = (extra: Record<string, unknown>): Record<string, unknown> => ({ path: RESOLVED_CONF, mode: 0o644, uid: 0, gid: 0, ...extra });

test('a loaded file with several records: resolved reads what ends up on disk', () => {
  const twice = loadWith([record({ kind: 'file', content: '[Resolve]\nLLMNR=yes\n' }), record({ kind: 'file', content: '[Resolve]\n' })]);
  assert.equal(resolvedConfig(twice).llmnr, 'no', 'before the system exists');
  assert.equal(run(twice, `cat ${RESOLVED_CONF}`), '[Resolve]');
  assert.equal(resolvedConfig(twice).llmnr, 'no', 'and after');
  const gone = loadWith([record({ kind: 'file', content: '[Resolve]\nLLMNR=yes\n' }), record({ kind: 'deleted', mode: 0 })]);
  assert.equal(resolvedConfig(gone).llmnr, 'no', 'a deleted file is the defaults');
});

test('warnings quote no control characters (they would recolour or clear the terminal)', () => {
  const c = parseResolvedConf('[Resolve]\n\x1b[2J\x1b[31mBad=1\n');
  assert.equal(c.warnings[0], `${RESOLVED_CONF}:2: Unknown key '?[2J?[31mBad' in section [Resolve], ignoring.`);
});
