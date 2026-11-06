/**
 * Option 44 (NetBIOS name servers) in the Packet Tracer-style DHCP of a server: the «Servidor WINS» of the pool goes
 * to the lease, to kea-dhcp4.conf and to the saved file; a Windows client shows it in ipconfig /all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { PtDhcpPool } from '../../src/services/config.ts';
import { ptPoolToIos, validatePool } from '../../src/services/dhcp-pt.ts';
import { servicesFromJson, servicesToJson } from '../../src/services/persist.ts';

const ip = (s: string): number => parseIp(s)!;

const POOL: PtDhcpPool = { name: 'serverPool', start: ip('192.168.1.100'), prefix: 24, maxUsers: 50, leaseMinutes: 60, reservations: [], wins: ip('192.168.1.2') };

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  pc.os = 'windows';
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: ip('192.168.1.2'), prefix: 24 });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [POOL] } });
  pc.useDhcp();
  t.settle();
  return { t, srv, pc };
}

test('the WINS of the pool is option 44 of the engine', () => {
  assert.deepEqual(ptPoolToIos(POOL).netbiosServers, [ip('192.168.1.2')]);
  assert.deepEqual(ptPoolToIos({ ...POOL, wins: undefined }).netbiosServers, []);
});

test('a Windows client of the server gets the WINS and shows it in ipconfig /all', () => {
  const { pc } = lab();
  assert.match(createShell(pc, 'windows').run('ipconfig /all').join('\n'), /Primary WINS Server[ .]+: 192\.168\.1\.2/);
});

test('kea-dhcp4.conf carries netbios-name-servers and passes kea-dhcp4 -t', () => {
  const { srv } = lab();
  const sh = createShell(srv, 'linux', 'root');
  assert.match(sh.run('cat /etc/kea/kea-dhcp4.conf').join('\n'), /\{ "name": "netbios-name-servers", "data": "192\.168\.1\.2" \}/);
  assert.match(sh.run('kea-dhcp4 -t /etc/kea/kea-dhcp4.conf; echo "status $?"').join('\n'), /status 0/);
});

test('the WINS is saved and read back, and an address that is not one is refused', () => {
  const { srv } = lab();
  const json = JSON.parse(JSON.stringify(servicesToJson(srv.services)));
  assert.equal(servicesFromJson(json).dhcp.pools[0]!.wins, ip('192.168.1.2'));
  json.dhcp.pools[0].wins = 'not-an-ip';
  assert.throws(() => servicesFromJson(json));
});

test('validatePool refuses a WINS that is a network or broadcast address', () => {
  assert.equal(validatePool(POOL, []), null);
  assert.notEqual(validatePool({ ...POOL, wins: 0 }, []), null);
  assert.notEqual(validatePool({ ...POOL, wins: ip('255.255.255.255') }, []), null);
});
