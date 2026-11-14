/** Characterization: marking a file is a pure function of (file, checklist): the wall clock must not change a result. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import type { ChecklistItem } from '../../src/classroom/checklist.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import type { TopologyFile } from '../../src/net/topology.ts';

/** Per device: existence, `show clock` on routers, and ping/dns from each PC (the checks that advance simulated time). */
function checklistFor(file: TopologyFile): ChecklistItem[] {
  const items: unknown[] = [];
  for (const d of file.devices) {
    items.push({ id: `dev-${d.id}`, check: { type: 'device', device: d.label } });
    if (d.kind === 'router') items.push({ id: `clock-${d.id}`, check: { type: 'output', device: d.label, command: 'show clock', contains: '2' } });
    if (d.kind === 'pc') {
      items.push({ id: `ping-${d.id}`, check: { type: 'ping', from: d.label, to: '8.8.8.8' } });
      items.push({ id: `dns-${d.id}`, check: { type: 'dns', from: d.label, name: 'www.google.com' } });
    }
  }
  return parseChecklist(items);
}

const run = (): string[] => EXAMPLES.map((ex) => {
  const file = ex.build().toJSON();
  return JSON.stringify(evaluate(file, checklistFor(file)));
});

test('evaluate twice over every lab (VPN labs included) gives the same result', () => {
  assert.ok(EXAMPLES.some((e) => e.id === 'vpn-ipsec') && EXAMPLES.some((e) => e.id === 'vpn-wireguard'));
  assert.deepEqual(run(), run());
});

test('evaluate with the wall clock shifted gives the same result', () => {
  const real = Date.now();
  const base = run();
  mock.method(Date, 'now', () => real + 400 * 24 * 3600 * 1000 + 12345);
  try {
    const shifted = run();
    EXAMPLES.forEach((ex, i) => assert.equal(shifted[i], base[i], ex.id));
  } finally {
    mock.restoreAll();
  }
});
