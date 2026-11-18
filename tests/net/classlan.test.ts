/** Classroom LAN: two labs (two Topologies, as two browsers) joined by an in-memory relay, NAT and bridge. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { ClassLan } from '../../src/devices/classlan.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';
import { classLanMessage } from '../../src/net/classlan.ts';
import type { ClassLanLink } from '../../src/net/classlan.ts';

const ip = (t: string): number => parseIp(t)!;
const sh = (h: Pc | Server, cmd: string): string => createShell(h, 'linux').run(cmd).join('\n');

interface Lab { readonly topo: Topology; readonly listeners: Set<(m: unknown) => void>; busy: boolean }

/** A relay like Netfix Classroom's: every message to every other lab (as JSON); a lab not busy runs to answer. */
function relay(): { join(topo: Topology, lab: number): ClassLanLink; run<T>(topo: Topology, fn: () => T): T } {
  const labs: Lab[] = [];
  const entryOf = (topo: Topology): Lab => labs.find((l) => l.topo === topo)!;
  return {
    join(topo, lab) {
      const me: Lab = { topo, listeners: new Set(), busy: false };
      labs.push(me);
      return {
        lab,
        send: (m) => {
          for (const other of labs.filter((l) => l !== me)) {
            const copy: unknown = JSON.parse(JSON.stringify(m));
            for (const l of other.listeners) l(copy);
            if (other.busy) continue;
            other.busy = true;
            other.topo.net.runFor(200);
            other.busy = false;
          }
        },
        onMessage: (l) => { me.listeners.add(l); return () => me.listeners.delete(l); },
      };
    },
    run(topo, fn) {
      const e = entryOf(topo);
      e.busy = true;
      try { return fn(); } finally { e.busy = false; }
    },
  };
}

test('NAT: a lab pings another lab\'s classroom address and reaches its web through a forwarded port', () => {
  const r = relay();
  const a = new Topology();
  const lanA = a.add('classlan', 0, 0).device as ClassLan;
  const pc = a.add('pc', 0, 0).device as Pc;
  a.connect({ device: lanA.id, port: 'Ethernet0' }, { device: pc.id, port: 'FastEthernet0' });
  a.useClassLan(r.join(a, 1));
  const b = new Topology();
  const lanB = b.add('classlan', 0, 0).device as ClassLan;
  const srv = b.add('server', 0, 0).device as Server;
  b.connect({ device: lanB.id, port: 'Ethernet0' }, { device: srv.id, port: 'FastEthernet0' });
  b.useClassLan(r.join(b, 2));
  srv.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  assert.equal(lanB.setSettings({ ...lanB.settings, router: { ...lanB.settings.router, forwards: [{ proto: 'tcp', port: 80, ip: ip('192.168.1.10'), toPort: 80 }] } }), null);
  pc.useDhcp();
  a.settle();
  b.settle();
  assert.equal(formatIp(lanA.classAddress() ?? 0), '10.1.1.2');
  assert.equal(formatIp(lanB.classAddress() ?? 0), '10.2.1.2');
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.1.33', 'the router\'s DHCP');
  assert.match(r.run(a, () => sh(pc, 'ping -c 2 10.2.1.2')), /2 received/);
  assert.match(r.run(a, () => sh(pc, 'curl -sI http://10.2.1.2/ | head -1')), /200 OK/, 'the forwarded port reaches the server');
  assert.match(r.run(a, () => sh(pc, 'curl -s http://10.2.1.2:8080/; echo rc=$?')), /rc=7/, 'a port not forwarded is refused');
});

test('bridge: two labs share a segment and ping each other\'s PCs directly', () => {
  const r = relay();
  const lab = (n: number, addr: string): { t: Topology; pc: Pc } => {
    const t = new Topology();
    const lan = t.add('classlan', 0, 0).device as ClassLan;
    const pc = t.add('pc', 0, 0).device as Pc;
    t.connect({ device: lan.id, port: 'Ethernet0' }, { device: pc.id, port: 'FastEthernet0' });
    assert.equal(lan.setSettings({ ...lan.settings, mode: 'bridge' }), null);
    t.useClassLan(r.join(t, n));
    pc.setStatic({ ip: ip(addr), prefix: 24 });
    t.settle();
    return { t, pc };
  };
  const one = lab(1, '172.20.0.1');
  lab(2, '172.20.0.2');
  assert.match(r.run(one.t, () => sh(one.pc, 'ping -c 2 172.20.0.2')), /2 received/);
});

test('what arrives from another lab is checked: only plain, small frames and packets with sane fields', () => {
  const frame = { src: '0011223344aa', dst: 'ffffffffffff', arp: { op: 'request', senderMac: '0011223344aa', senderIp: 1, targetMac: '000000000000', targetIp: 2 } };
  assert.deepEqual(classLanMessage({ kind: 'frame', frame }), { kind: 'frame', frame });
  assert.equal(classLanMessage({ kind: 'frame', frame: { ...frame, src: '<b>' } }), null, 'a MAC that is not one');
  assert.equal(classLanMessage({ kind: 'ip', packet: { src: -1, dst: 2, ttl: 64, protocol: 'icmp' } }), null);
  assert.equal(classLanMessage({ kind: 'ip', packet: { src: 1, dst: 2, ttl: 64, protocol: 'gre' } }), null);
  assert.equal(classLanMessage({ kind: 'frame', frame: { ...frame, pad: 'x'.repeat(20_000) } }), null, 'too big');
  assert.equal(classLanMessage('frame'), null);
});

test('without a class the device keeps its settings, is disconnected, and survives save and load', () => {
  const t = new Topology();
  const lan = t.add('classlan', 0, 0).device as ClassLan;
  lan.setSettings({ ...lan.settings, mode: 'bridge' });
  assert.equal(lan.connected(), false);
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = [...back.placed.values()].find((p) => p.device.kind === 'classlan')?.device as ClassLan;
  assert.equal(again.settings.mode, 'bridge');
  assert.equal(again.connected(), false);
});
