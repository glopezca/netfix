/** Checks added for the guided labs: TCP ports, names that must not resolve, and the output of an IOS show command. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import type { TopologyFile } from '../../src/net/topology.ts';

function lab(id: string): TopologyFile {
  const ex = EXAMPLES.find((e) => e.id === id);
  assert.ok(ex, id);
  return ex.build().toJSON();
}

const passed = (r: ReturnType<typeof evaluate>): Record<string, boolean> => Object.fromEntries(r.items.map((i) => [i.id, i.passed]));

test('tcp: a port is open or blocked from a host, through the ACLs and firewalls on the way', () => {
  const checklist = parseChecklist([
    { id: 'admin-ssh', check: { type: 'tcp', from: 'ADMIN', to: '172.20.0.10', port: 22 } },
    { id: 'alumno-web', check: { type: 'tcp', from: 'ALUMNO', to: '172.20.0.10', port: 80 } },
    { id: 'alumno-ssh', check: { type: 'tcp', from: 'ALUMNO', to: '172.20.0.10', port: 22, expect: 'fail' } },
    { id: 'wrong', check: { type: 'tcp', from: 'ALUMNO', to: '172.20.0.10', port: 22 } },
  ]);
  const r = evaluate(lab('bastionado'), checklist);
  assert.deepEqual(passed(r), { 'admin-ssh': true, 'alumno-web': true, 'alumno-ssh': true, wrong: false });
  assert.match(r.items.find((i) => i.id === 'wrong')?.detail ?? '', /22/);
});

test('dns with expect fail: the name must not resolve (recursion refused to the guests)', () => {
  const checklist = parseChecklist([
    { id: 'guest-out', check: { type: 'dns', from: 'INVITADO', name: 'www.google.com', expect: 'fail' } },
    { id: 'lan-out', check: { type: 'dns', from: 'PC0', name: 'www.google.com', expect: 'fail' } },
    { id: 'guest-in', check: { type: 'dns', from: 'INVITADO', name: 'www.empresa.lan' } },
  ]);
  const r = evaluate(lab('dns-reenvio'), checklist);
  assert.deepEqual(passed(r), { 'guest-out': true, 'lan-out': false, 'guest-in': true });
});

test('output: a show command run on an IOS device must print a text', () => {
  const checklist = parseChecklist([
    { id: 'pool', check: { type: 'output', device: 'GW', command: 'show ip dhcp binding', contains: '192.168.10.' } },
    { id: 'absent', check: { type: 'output', device: 'GW', command: 'show ip dhcp binding', contains: '10.99.99.' } },
    { id: 'pc', check: { type: 'output', device: 'PC0', command: 'show version', contains: 'x' } },
  ]);
  const r = evaluate(lab('basico'), checklist);
  assert.deepEqual(passed(r), { pool: true, absent: false, pc: false });
});

test('the new checks are validated: ports in range, only show commands, known expectations', () => {
  for (const bad of [
    [{ id: 'a', check: { type: 'tcp', from: 'PC0', to: '1.1.1.1', port: 0 } }],
    [{ id: 'a', check: { type: 'tcp', from: 'PC0', to: '1.1.1.1', port: 70000 } }],
    [{ id: 'a', check: { type: 'tcp', from: 'PC0', to: '1.1.1.1' } }],
    [{ id: 'a', check: { type: 'dns', from: 'PC0', name: 'x.lan', expect: 'maybe' } }],
    [{ id: 'a', check: { type: 'output', device: 'GW', command: 'configure terminal', contains: 'x' } }],
    [{ id: 'a', check: { type: 'output', device: 'GW', command: 'show ip route\nreload', contains: 'x' } }],
    [{ id: 'a', check: { type: 'output', device: 'GW', command: 'show run' } }],
  ]) assert.throws(() => parseChecklist(bad), /lista de comprobación/i, JSON.stringify(bad));
});

test('a guided lab reports the hints used and whether the solution was loaded; a plain file reports neither', () => {
  const checklist = parseChecklist([{ id: 'pool', check: { type: 'config', device: 'GW', section: 'ip dhcp pool LAN', lines: [' default-router 192.168.10.1'] } }]);
  assert.equal('mission' in evaluate(lab('basico'), checklist), false);
  const r = evaluate({ ...lab('basico'), mission: { id: 'basico', hints: ['1.1', '1.2'] } }, checklist);
  assert.deepEqual(r.mission, { id: 'basico', hints: 2, solution: false });
  const seen = evaluate({ ...lab('basico'), mission: { id: 'basico', hints: [], solution: true } }, checklist);
  assert.deepEqual(seen.mission, { id: 'basico', hints: 0, solution: true });
});
