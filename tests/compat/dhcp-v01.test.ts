/**
 * Compatibility with Netfix v0.1 (before Server).
 *
 * The fixtures in tests/fixtures/v0.1 were produced by the v0.1 code (commit fdcf3d3):
 * the v1 topology files of every lab, the IOS/PC outputs of each lab and a scenario with
 * every IOS reservation style. The current code must reproduce them exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { Pc } from '../../src/devices/pc.ts';
import { pcCommand } from '../../src/devices/pc-console.ts';
import { applyConfig, Session } from '../../src/ios/session.ts';
import { clientIdFromMac, formatHexId, formatMacCisco } from '../../src/core/mac.ts';

const DIR = new URL('../fixtures/v0.1/', import.meta.url);
const SHOWS = ['show running-config', 'show ip dhcp binding', 'show ip dhcp pool', 'show ip dhcp server statistics', 'show ip dhcp conflict', 'show ip interface brief'];
const DATE = /[A-Z][a-z]{2} \d{1,2} \d{4} \d{2}:\d{2} [AP]M/g;

type Outputs = Record<string, string[]>;

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T;
}

/** Lease expirations depend on the wall clock; everything else must match literally. */
function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(DATE, '<FECHA>')) as T;
}

function exec(dev: Router, line: string): string[] {
  const s = new Session(dev);
  s.mode = 'exec';
  return s.input(line);
}

function snapshot(t: Topology): Outputs {
  const out: Outputs = {};
  for (const { device: d, label } of t.placed.values()) {
    if (d instanceof Router) for (const c of SHOWS) out[`${d.name}|${c}`] = exec(d, c);
    // PCs by their device name: the host name (pc0) is derived from it since v0.16.
    if (d instanceof Pc) for (const c of ['ipconfig /all', 'ipconfig']) out[`${label}|${c}`] = pcCommand(d, c);
  }
  return normalize(out);
}

const golden = fixture<Record<string, Outputs>>('ios-outputs.json');
const LAB_IDS = Object.keys(golden);

test('v0.1 labs produce the same IOS and PC outputs as before Server', () => {
  assert.ok(LAB_IDS.includes('reservas') && LAB_IDS.length === 7);
  for (const id of LAB_IDS) {
    const ex = EXAMPLES.find((e) => e.id === id);
    assert.ok(ex, `falta el laboratorio ${id}`);
    assert.deepEqual(snapshot(ex.build()), golden[id], id);
  }
});

test('v1 topology files saved by v0.1 open and lease the same addresses', () => {
  for (const id of LAB_IDS) {
    const t = Topology.fromJSON(fixture<unknown>(`${id}.json`));
    const now = snapshot(t);
    for (const [key, lines] of Object.entries(golden[id] ?? {})) {
      if (key.endsWith('|show running-config')) assert.deepEqual(now[key], lines, `${id} ${key}`);
      if (key.endsWith('|ipconfig')) assert.deepEqual(now[key], lines, `${id} ${key}`);
    }
  }
});

test('v1 files re-saved by the current version keep every IOS line', () => {
  for (const id of LAB_IDS) {
    const v1 = fixture<{ devices: { id: string; config?: string[] }[] }>(`${id}.json`);
    const v2 = Topology.fromJSON(v1).toJSON() as unknown as { version: number; devices: { id: string; config?: string[] }[] };
    assert.equal(v2.version, 2);
    for (const d of v1.devices) assert.deepEqual(v2.devices.find((x) => x.id === d.id)?.config, d.config, `${id} ${d.id}`);
  }
});

/** Every reservation style of IOS 15 in one LAN (same scenario as reservas-completo.json). */
function reservationScenario(): Record<string, unknown> {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const s = t.add('switch', 0, 0).device as Switch;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: s.id, port: 'GigabitEthernet0/1' });
  const p = [0, 1, 2, 3, 4].map((i) => {
    const pc = t.add('pc', 0, 0).device as Pc;
    t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: s.id, port: `FastEthernet0/${i + 1}` });
    return pc;
  }) as [Pc, Pc, Pc, Pc, Pc];
  p[4].sendClientId = false;
  const errs = applyConfig(r, reservationConfig(p).split('\n'));
  for (const pc of p) pc.useDhcp();
  t.settle();
  const out: Record<string, unknown> = { errs };
  for (const c of ['show running-config', 'show ip dhcp binding', 'show ip dhcp pool', 'show ip dhcp server statistics']) out[c] = exec(r, c);
  p.forEach((pc, i) => (out[`pc${i}`] = pcCommand(pc, 'ipconfig /all')));
  const session = new Session(r);
  session.mode = 'exec';
  out.ro = ['conf t', 'ip dhcp pool LAN', 'reserved-only', 'no address 192.168.10.152', 'do show running-config', 'end'].map((l) => session.input(l));
  return normalize(out);
}

function reservationConfig(p: readonly Pc[]): string {
  const [a, b, c, d, e] = p as [Pc, Pc, Pc, Pc, Pc];
  return `hostname GW
ip dhcp excluded-address 192.168.10.1 192.168.10.20
ip dhcp excluded-address 192.168.10.30
ip dhcp pool LAN
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
 dns-server 192.168.10.2 8.8.8.8
 domain-name aula.lab
 lease 0 8 30
 address 192.168.10.150 client-id ${formatHexId(clientIdFromMac(c.mac))}
 address 192.168.10.151 hardware-address ${formatMacCisco(d.mac)} ethernet
 address 192.168.10.152 client-id pc-ascii ascii
ip dhcp pool PC0
 host 192.168.10.100 255.255.255.0
 client-identifier ${formatHexId(clientIdFromMac(a.mac))}
 client-name pc0
 default-router 192.168.10.254
ip dhcp pool PC1
 host 192.168.10.101 /24
 hardware-address ${formatMacCisco(b.mac)}
ip dhcp pool SIN-ID
 host 192.168.10.102 255.255.255.0
 hardware-address ${formatMacCisco(e.mac)}
interface GigabitEthernet0/0
 ip address 192.168.10.1 255.255.255.0
 no shutdown`;
}

test('every IOS reservation style behaves exactly as in v0.1', () => {
  const now = reservationScenario();
  assert.deepEqual(now, fixture('reservas-completo.json'));
  const binding = (now['show ip dhcp binding'] as string[]).join('\n');
  for (const ip of ['192.168.10.100', '192.168.10.101', '192.168.10.102', '192.168.10.150', '192.168.10.151']) assert.match(binding, new RegExp(ip.replace(/\./g, '\\.')));
});
