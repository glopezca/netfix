/** Headless marking: a checklist evaluated on a topology file, with no interface (as a Worker would run it). */
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

test('devices, links, addressing and IOS configuration lines', () => {
  const checklist = parseChecklist([
    { id: 'router', check: { type: 'device', device: 'GW', kind: 'router' } },
    { id: 'no-server', check: { type: 'device', device: 'SRV9' } },
    { id: 'cable', check: { type: 'link', a: 'PC0', b: 'Switch0' } },
    { id: 'no-cable', check: { type: 'link', a: 'PC0', b: 'GW' } },
    { id: 'dhcp', weight: 2, check: { type: 'ip', device: 'PC1', mode: 'dhcp', network: '192.168.10.0/24', gateway: '192.168.10.1' } },
    { id: 'static', check: { type: 'ip', device: 'PC1', mode: 'static' } },
    { id: 'pool', weight: 3, check: { type: 'config', device: 'GW', lines: ['ip dhcp pool LAN', ' default-router 192.168.10.1'] } },
    { id: 'no-pool', check: { type: 'config', device: 'GW', lines: ['ip dhcp pool OTRO'] } },
  ]);
  const r = evaluate(lab('basico'), checklist);
  assert.deepEqual(passed(r), { router: true, 'no-server': false, cable: true, 'no-cable': false, dhcp: true, static: false, pool: true, 'no-pool': false });
  assert.deepEqual([r.score, r.max], [7, 11]);
  assert.match(r.items.find((i) => i.id === 'no-pool')?.detail ?? '', /ip dhcp pool OTRO/);
});

test('ping, DNS, HTTP and files are checked from inside the simulation', () => {
  const checklist = parseChecklist([
    { id: 'ping-gw', check: { type: 'ping', from: 'PC0', to: '192.168.50.1' } },
    { id: 'ping-name', check: { type: 'ping', from: 'PC0', to: 'ns1.empresa.lan' } },
    { id: 'nobody', check: { type: 'ping', from: 'INVITADO', to: '192.168.50.99', expect: 'fail' } },
    { id: 'dns', check: { type: 'dns', from: 'PC0', name: 'www.empresa.lan', ip: '192.168.50.2' } },
    { id: 'dns-wrong', check: { type: 'dns', from: 'PC0', name: 'www.empresa.lan', ip: '10.0.0.1' } },
    { id: 'web', check: { type: 'http', from: 'PC0', url: 'http://www.empresa.lan/', status: 200 } },
    { id: 'hosts', check: { type: 'file', device: 'PC0', path: '/etc/hosts', contains: 'localhost' } },
    { id: 'missing', check: { type: 'file', device: 'PC0', path: '/home/alumno/informe.txt' } },
    { id: 'ios-ping', check: { type: 'ping', from: 'GW', to: '192.168.50.2' } },
  ]);
  const r = evaluate(lab('dns-reenvio'), checklist);
  assert.deepEqual(passed(r), { 'ping-gw': true, 'ping-name': true, nobody: true, dns: true, 'dns-wrong': false, web: true, hosts: true, missing: false, 'ios-ping': true });
});

test('a check on a device that is missing or of the wrong kind fails with a reason, never throws', () => {
  const checklist = parseChecklist([
    { id: 'a', check: { type: 'ping', from: 'NADIE', to: '1.1.1.1' } },
    { id: 'b', check: { type: 'config', device: 'PC0', lines: ['hostname X'] } },
    { id: 'c', check: { type: 'file', device: 'GW', path: '/etc/hosts' } },
    { id: 'd', check: { type: 'dns', from: 'Switch0', name: 'x.lan' } },
  ]);
  const r = evaluate(lab('basico'), checklist);
  assert.equal(r.score, 0);
  for (const i of r.items) assert.ok(i.detail.length > 0, i.id);
});

test('the topology file is checked: invalid JSON gives no score instead of an exception', () => {
  const checklist = parseChecklist([{ id: 'a', check: { type: 'device', device: 'PC0' } }]);
  assert.throws(() => evaluate({ format: 'otro' }, checklist), /topolog/i);
});

test('the checklist is untrusted JSON and is validated', () => {
  for (const bad of [
    {}, [{}], [{ id: 'a', check: { type: 'regex', device: 'PC0' } }], [{ id: 'a', weight: -1, check: { type: 'device', device: 'PC0' } }],
    [{ id: 'a', check: { type: 'device', device: 'PC0' } }, { id: 'a', check: { type: 'device', device: 'PC1' } }],
    [{ id: 'a', check: { type: 'ping', from: 'PC0', to: '1.1.1.1', expect: 'maybe' } }],
    [{ id: 'a', check: { type: 'ip', device: 'PC0', network: '10.0.0.0/33' } }],
    [{ id: 'a', check: { type: 'http', from: 'PC0', url: 'ftp://x' } }],
    [{ id: 'a', check: { type: 'config', device: 'R', lines: [] } }],
    [{ id: 'a', check: { type: 'device', device: 'PC0', extra: 1 } }],
    Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, check: { type: 'device', device: 'PC0' } })),
  ]) assert.throws(() => parseChecklist(bad), /lista de comprobación|checklist/i, JSON.stringify(bad).slice(0, 80));
});

function withHostsEntry(): TopologyFile {
  const file = lab('basico');
  const pc0 = file.devices.find((d) => d.label === 'PC0')!;
  const hosts = { path: '/etc/hosts', kind: 'file' as const, content: '127.0.0.1 localhost\n192.168.10.1 gw.aula.lab\n', mode: 0o644, uid: 0, gid: 0 };
  return { ...file, devices: file.devices.map((d) => (d === pc0 ? { ...d, pc: { ...d.pc!, files: [hosts] } } : d)) };
}

test('dns needs a DNS answer: an /etc/hosts entry or an IP literal is not one', () => {
  const r = evaluate(withHostsEntry(), parseChecklist([{ id: 'dns', check: { type: 'dns', from: 'PC0', name: 'gw.aula.lab' } }]));
  assert.equal(r.items[0]?.passed, false);
  assert.match(r.items[0]?.detail ?? '', /DNS/);
  assert.throws(() => parseChecklist([{ id: 'a', check: { type: 'dns', from: 'PC0', name: '10.0.0.1' } }]), /comprobación/);
});

test('results do not depend on the order of the checks (saved files apply from the start, passive checks first)', () => {
  const ping = { id: 'ping', check: { type: 'ping', from: 'PC0', to: 'gw.aula.lab' } };
  const file = { id: 'file', check: { type: 'file', device: 'PC0', path: '/etc/hosts', contains: 'gw.aula.lab' } };
  const a = evaluate(withHostsEntry(), parseChecklist([ping, file]));
  const b = evaluate(withHostsEntry(), parseChecklist([file, ping]));
  assert.deepEqual(passed(a), { ping: true, file: true });
  assert.deepEqual(passed(b), passed(a));
  assert.deepEqual(a.items.map((i) => i.id), ['ping', 'file'], 'reported in the order of the checklist');
});

test('a ping expected to fail needs a probe that really left: no address, no route or no name is not a block', () => {
  const file = lab('basico');
  const bare = { ...file, devices: file.devices.map((d) => (d.label === 'PC2' ? { ...d, pc: { mode: 'static' } } : d)) } as TopologyFile;
  const r = evaluate(bare, parseChecklist([
    { id: 'noip', check: { type: 'ping', from: 'PC2', to: '192.168.10.1', expect: 'fail' } },
    { id: 'noname', check: { type: 'ping', from: 'PC0', to: 'nadie.lan', expect: 'fail' } },
    { id: 'silent', check: { type: 'ping', from: 'PC0', to: '192.168.10.250', expect: 'fail' } },
  ]));
  assert.deepEqual(passed(r), { noip: false, noname: false, silent: true });
});

test('config lines can be required inside one section (an interface, a pool)', () => {
  const r = evaluate(lab('basico'), parseChecklist([
    { id: 'gi0', check: { type: 'config', device: 'GW', section: 'interface GigabitEthernet0/0', lines: ['description LAN de alumnos', 'ip address 192.168.10.1 255.255.255.0'] } },
    { id: 'gi1', check: { type: 'config', device: 'GW', section: 'interface GigabitEthernet0/1', lines: ['ip address 192.168.10.1 255.255.255.0'] } },
    { id: 'none', check: { type: 'config', device: 'GW', section: 'interface Loopback9', lines: ['no shutdown'] } },
  ]));
  assert.deepEqual(passed(r), { gi0: true, gi1: false, none: false });
});

test('a label shared by two devices is ambiguous and fails; a title cannot hold control characters', () => {
  const file = lab('basico');
  const twin = { ...file, devices: file.devices.map((d) => (d.label === 'PC1' ? { ...d, label: 'PC0' } : d)) };
  const r = evaluate(twin, parseChecklist([{ id: 'a', check: { type: 'device', device: 'PC0' } }]));
  assert.equal(r.items[0]?.passed, false);
  assert.match(r.items[0]?.detail ?? '', /varios/);
  assert.throws(() => parseChecklist([{ id: 'a', title: 'x\u0007', check: { type: 'device', device: 'PC0' } }]), /comprobación/);
});

test('a switching loop is refused in bounded time instead of hanging the marking', () => {
  const devices = [
    { id: 's1', kind: 'switch', x: 0, y: 0, seed: 1, label: 'S1' },
    { id: 's2', kind: 'switch', x: 0, y: 0, seed: 2, label: 'S2' },
    { id: 'p', kind: 'pc', x: 0, y: 0, seed: 3, label: 'PC0', pc: { mode: 'dhcp' } },
  ];
  const links = [1, 2, 3].map((n) => ({ a: { device: 's1', port: `FastEthernet0/${n}` }, b: { device: 's2', port: `FastEthernet0/${n}` }, cable: 'auto' }));
  links.push({ a: { device: 'p', port: 'FastEthernet0' }, b: { device: 's1', port: 'FastEthernet0/24' }, cable: 'auto' });
  const start = performance.now();
  assert.throws(() => evaluate({ format: 'netfix', version: 2, devices, links }, parseChecklist([{ id: 'a', check: { type: 'device', device: 'PC0' } }])), /tráfico/);
  assert.ok(performance.now() - start < 5000);
});

test('checklist texts cannot hide characters (direction overrides, zero width) that students would see', () => {
  for (const bad of ['PC‮0', 'PC​0', 'a b']) {
    assert.throws(() => parseChecklist([{ id: 'a', check: { type: 'device', device: bad } }]), /comprobación/, JSON.stringify(bad));
    assert.throws(() => parseChecklist([{ id: 'a', title: bad, check: { type: 'device', device: 'PC0' } }]), /comprobación/);
  }
  assert.doesNotThrow(() => parseChecklist([{ id: 'a', title: 'Configuración del PC «aula» ñ', check: { type: 'config', device: 'R', lines: [' ip address 10.0.0.1 255.0.0.0'] } }]));
});

test('an internal error while loading is not described to the caller', () => {
  const broken = { format: 'netfix', version: 2, devices: [{ id: 'p', kind: 'pc', x: 0, y: 0, seed: 1, label: 'PC0', pc: 42 }], links: [] };
  let message = '';
  try {
    evaluate(broken, parseChecklist([{ id: 'a', check: { type: 'device', device: 'PC0' } }]));
  } catch (e) {
    message = e instanceof Error ? e.message : '';
  }
  assert.doesNotMatch(message, /Cannot read|undefined|TypeError/);
});
