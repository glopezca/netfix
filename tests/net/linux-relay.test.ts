/**
 * isc-dhcp-relay on the GNU/Linux router (S26 phase 3): disabled as Ubuntu installs it; root writes
 * /etc/default/isc-dhcp-relay and starts the unit; DHCP requests from the LAN reach a server in another network
 * with the LAN's address as giaddr, and the replies come back to the clients.
 *
 *   srv 10.0.0.1 (Kea, pool 10.20.0.0/24) ── eth0 10.0.0.2 [lr] eth1 10.20.0.1 ── pc (DHCP)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { formatIp, parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');
const F = '/etc/default/isc-dhcp-relay';

function lab(): { t: Topology; lr: LinuxRouter; pc: Pc; root: ShellSession } {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/0' }, { device: srv.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  const root = createShell(lr, 'linux', 'root');
  root.run('export SYSTEMD_COLORS=0; ip addr add 10.0.0.2/24 dev eth0; ip addr add 10.20.0.1/24 dev eth1; sysctl -w net.ipv4.ip_forward=1');
  srv.setStatic({ ip: ip('10.0.0.1'), prefix: 24, gateway: ip('10.0.0.2') });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'SEDE-B', start: ip('10.20.0.100'), prefix: 24, maxUsers: 50, gateway: ip('10.20.0.1'), leaseMinutes: 1440, reservations: [] }] } });
  t.settle();
  return { t, lr, pc, root };
}

const lease = (t: Topology, pc: Pc): string => {
  pc.useDhcp();
  t.settle();
  const got = pc.config.ip === undefined ? '' : formatIp(pc.config.ip);
  return got === '' || got.startsWith('169.254.') ? 'none' : `${got} gw ${formatIp(pc.config.gateway ?? 0)}`; // APIPA: no lease
};

test('installed but disabled and inactive, with Ubuntu\'s empty file: no lease across the router', () => {
  const { t, pc, root } = lab();
  assert.deepEqual(root.run('systemctl is-enabled isc-dhcp-relay; systemctl is-active isc-dhcp-relay'), ['disabled', 'inactive']);
  assert.match(all(root.run(`cat ${F}`)), /^SERVERS=""$/m);
  assert.equal(lease(t, pc), 'none');
});

test('SERVERS and INTERFACES set and the unit started: the PC gets its lease through the relay', () => {
  const { t, lr, pc, root } = lab();
  root.run(`sed -i 's/^SERVERS=.*/SERVERS="10.0.0.1"/; s/^INTERFACES=.*/INTERFACES="eth1 eth0"/' ${F}`);
  assert.deepEqual(root.run('systemctl start isc-dhcp-relay; echo $?; systemctl is-active isc-dhcp-relay'), ['0', 'active']);
  assert.equal(lease(t, pc), '10.20.0.100 gw 10.20.0.1');
  assert.deepEqual(lr.services.relay, { enabled: true, servers: [ip('10.0.0.1')], interfaces: ['eth1', 'eth0'] }, 'the file became the model');
  root.run('systemctl stop isc-dhcp-relay');
  pc.releaseDhcp();
  t.settle();
  assert.equal(lease(t, pc), 'none', 'stopped: nothing relayed');
});

test('a file dhcrelay refuses leaves the unit failed with its error in the journal', () => {
  const { root } = lab();
  root.run(`sed -i 's/^INTERFACES=.*/INTERFACES="eth9"/; s/^SERVERS=.*/SERVERS="10.0.0.1"/' ${F}`);
  root.run('systemctl start isc-dhcp-relay');
  assert.deepEqual(root.run('systemctl is-active isc-dhcp-relay'), ['failed']);
  assert.match(all(root.run('journalctl -u isc-dhcp-relay')), /Error getting hardware address for "eth9": No such device/);
});

test('the relay settings and the edited file are saved with the lab', () => {
  const { t, root } = lab();
  root.run(`sed -i 's/^SERVERS=.*/SERVERS="10.0.0.1"/' ${F}; systemctl enable --now isc-dhcp-relay`);
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const lr2 = [...back.placed.values()].map((p) => p.device).find((d) => d.kind === 'linuxrouter') as LinuxRouter;
  assert.deepEqual(lr2.services.relay, { enabled: true, servers: [ip('10.0.0.1')], interfaces: [] });
  assert.equal(lr2.autostart.relay, true);
});

test('two relays that send to each other stop at 10 hops, as dhcrelay -c 10 (no storm)', () => {
  const t = new Topology();
  const [a, b] = [t.add('linuxrouter', 0, 0).device as LinuxRouter, t.add('linuxrouter', 0, 0).device as LinuxRouter];
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: a.id, port: 'GigabitEthernet0/0' }, { device: b.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: a.id, port: 'GigabitEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  const [ra, rb] = [createShell(a, 'linux', 'root'), createShell(b, 'linux', 'root')];
  ra.run(`ip addr add 10.0.0.1/24 dev eth0; ip addr add 10.20.0.1/24 dev eth1; sed -i 's/^SERVERS=.*/SERVERS="10.0.0.2"/' ${F}; systemctl start isc-dhcp-relay`);
  rb.run(`ip addr add 10.0.0.2/24 dev eth0; sed -i 's/^SERVERS=.*/SERVERS="10.0.0.1"/' ${F}; systemctl start isc-dhcp-relay`);
  pc.useDhcp();
  t.settle();
  const forwarded = (r: LinuxRouter): number => r.logs.filter((l) => l.unit === 'relay' && l.line.startsWith('Forwarded BOOTREQUEST')).length;
  assert.ok(forwarded(a) + forwarded(b) <= 40, `bounded: ${forwarded(a)} + ${forwarded(b)}`);
});
