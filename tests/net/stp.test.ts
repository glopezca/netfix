/** Spanning tree (802.1D per VLAN): root election, root ports, designated ports and the blocked ones. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStp } from '../../src/net/stp.ts';
import type { StpBridge, StpLink } from '../../src/net/stp.ts';

const port = (n: number, vlans: number[] = [1], cost = 19) => ({ name: `Fa0/${n}`, number: n, cost, priority: 128, edge: false, vlans });

function bridge(id: string, mac: string, ports: StpBridge['ports'], prio: Record<number, number | null> = {}): StpBridge {
  return { id, mac, ports, priority: (v) => (v in prio ? prio[v] ?? null : 32768) };
}

const link = (a: string, ap: string, b: string, bp: string): StpLink => ({ a: { device: a, port: ap }, b: { device: b, port: bp } });

/** S1 (lowest MAC) — S2 — S3 in a triangle: S1 is root, S3's port towards S2 blocks. */
function triangle(prio: Record<number, number | null> = {}) {
  const bridges = [
    bridge('s1', '000000000001', [port(1), port(2)], prio),
    bridge('s2', '000000000002', [port(1), port(2)]),
    bridge('s3', '000000000003', [port(1), port(2)]),
  ];
  const links = [link('s1', 'Fa0/1', 's2', 'Fa0/1'), link('s1', 'Fa0/2', 's3', 'Fa0/1'), link('s2', 'Fa0/2', 's3', 'Fa0/2')];
  return computeStp(bridges, links);
}

test('the lowest bridge ID is the root and all its ports are designated', () => {
  const r = triangle();
  const s1 = r.get('s1')?.get(1);
  assert.ok(s1);
  assert.deepEqual(s1.root, { priority: 32769, mac: '000000000001' }, 'priority plus the VLAN (extend system-id)');
  assert.equal(s1.cost, 0);
  assert.equal(s1.rootPort, undefined);
  assert.deepEqual([...s1.ports.values()].map((p) => `${p.role} ${p.forwarding}`), ['Desg true', 'Desg true']);
});

test('the others choose a root port, and the link between them blocks on the higher bridge', () => {
  const r = triangle();
  assert.equal(r.get('s2')?.get(1)?.rootPort, 'Fa0/1');
  assert.equal(r.get('s2')?.get(1)?.cost, 19);
  assert.equal(r.get('s2')?.get(1)?.ports.get('Fa0/2')?.role, 'Desg');
  assert.equal(r.get('s3')?.get(1)?.ports.get('Fa0/1')?.role, 'Root');
  assert.deepEqual(r.get('s3')?.get(1)?.ports.get('Fa0/2'), { role: 'Altn', forwarding: false, cost: 19, priority: 128, number: 2, edge: false });
});

test('a lower priority wins over the MAC; no spanning-tree vlan leaves the bridge out', () => {
  const r = computeStp([
    bridge('s1', '000000000001', [port(1), port(2)]),
    bridge('s2', '000000000009', [port(1), port(2)], { 1: 4096 }),
  ], [link('s1', 'Fa0/1', 's2', 'Fa0/1'), link('s1', 'Fa0/2', 's2', 'Fa0/2')]);
  assert.deepEqual(r.get('s1')?.get(1)?.root, { priority: 4097, mac: '000000000009' });
  assert.equal(r.get('s1')?.get(1)?.rootPort, 'Fa0/1', 'between two equal paths, the lower port of the sender');
  assert.equal(r.get('s1')?.get(1)?.ports.get('Fa0/2')?.role, 'Altn');
  const off = triangle({ 1: null });
  assert.equal(off.get('s1')?.get(1), undefined, 'STP off for VLAN 1 on S1');
});

test('each VLAN has its own tree; ports to hosts are designated', () => {
  const r = computeStp([
    bridge('s1', '000000000001', [port(1, [1, 10]), port(2, [1, 10]), port(3, [10])], { 10: 61440 }),
    bridge('s2', '000000000002', [port(1, [1, 10]), port(2, [1, 10])]),
  ], [link('s1', 'Fa0/1', 's2', 'Fa0/1'), link('s1', 'Fa0/2', 's2', 'Fa0/2')]);
  assert.equal(r.get('s1')?.get(1)?.rootPort, undefined, 'S1 is root of VLAN 1');
  assert.equal(r.get('s1')?.get(10)?.rootPort, 'Fa0/1', 'S2 is root of VLAN 10');
  assert.equal(r.get('s1')?.get(10)?.ports.get('Fa0/3')?.role, 'Desg', 'Fa0/3 goes to a host');
  assert.equal(r.get('s1')?.get(10)?.ports.get('Fa0/2')?.forwarding, false);
});
