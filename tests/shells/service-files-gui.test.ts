/**
 * Hand-edited service files and the interface (decisions 7 and 8 of Fase 59): a change of the model from Servicios or
 * the web management writes the files again from the model, as Webmin does (an edit not yet applied is lost).
 * Starting, stopping or a failed start do not. A lab loaded from a file starts its services with the saved files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { savedFiles } from '../../src/shells/host-system.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import type { DnsZone } from '../../src/services/config.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const DB = '/etc/bind/db.aula.lab';
const LOCAL = '/etc/bind/named.conf.local';
const KEA = '/etc/kea/kea-dhcp4.conf';

function lab(): { t: Topology; srv: Server; root: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setStatic({ ip: ip('192.168.10.2'), prefix: 24 });
  const zone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [{ name: 'ns', type: 'A' as const, value: '192.168.10.2', ttl: 3600 }] };
  srv.setServices({ ...srv.services, dns: { enabled: true, zones: [zone] } });
  const root = createShell(srv, 'linux', 'root');
  root.run('export SYSTEMD_COLORS=0');
  return { t, srv, root };
}

const ZONE = `$TTL 3600
@     IN SOA ns.aula.lab. jefe.aula.lab. ( 2026110601 7200 900 1209600 300 )
      IN NS  ns
ns    IN A   192.168.10.2
www   IN A   192.168.10.81`;

const write = (root: ShellSession, path: string, text: string): void => { root.run(`cat > ${path} <<'EOF'\n${text}\nEOF`); };
const cat = (root: ShellSession, path: string): string => root.run(`cat ${path}`).join('\n');
const userFile = (srv: Server, path: string): boolean => (savedFiles(srv) ?? []).some((f) => f.path === path && f.kind === 'file');

/** What Servicios → DNS does when a record is added to the first zone. */
function addRecord(srv: Server, name: string, value: string): void {
  const [first, ...rest] = srv.services.dns.zones;
  const zone: DnsZone = { ...first!, records: [...first!.records, { name, type: 'A', value, ttl: 3600 }] };
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, zones: [zone, ...rest] } });
}

test('a change from the interface writes the BIND files again; the edit not yet applied is lost', () => {
  const { srv, root } = lab();
  write(root, DB, ZONE);
  addRecord(srv, 'web', '192.168.10.90');
  const db = cat(root, DB);
  assert.match(db, /192\.168\.10\.90/);
  assert.doesNotMatch(db, /192\.168\.10\.81/);
  assert.equal(userFile(srv, DB), false, 'the generated file again: not saved with the lab');
});

test('an applied edit is the model: the interface change keeps it in the files written again', () => {
  const { srv, root } = lab();
  write(root, DB, ZONE);
  root.run('systemctl restart named');
  assert.equal(userFile(srv, DB), true, 'applying does not write the file again');
  assert.match(cat(root, DB), /jefe\.aula\.lab\./);
  addRecord(srv, 'web', '192.168.10.90');
  const db = cat(root, DB);
  assert.match(db, /192\.168\.10\.81/);
  assert.match(db, /192\.168\.10\.90/);
});

test('stop, start and a failed start leave the files root wrote', () => {
  const { srv, root } = lab();
  const local = cat(root, LOCAL);
  write(root, LOCAL, `${local}\nzone "rota.lab" {\n\ttype master\n};`);
  root.run('systemctl stop named');
  root.run('systemctl start named');
  assert.equal(root.run('systemctl is-active named')[0], 'failed');
  assert.match(cat(root, LOCAL), /rota\.lab/, 'so that root can fix it');
  assert.equal(userFile(srv, LOCAL), true);
});

test('Servicios → DHCP writes kea-dhcp4.conf again', () => {
  const { srv, root } = lab();
  const conf = cat(root, KEA);
  write(root, KEA, conf.replace('"Dhcp4": {', '"Dhcp4": {\n    "valid-lifetime": 600,'));
  assert.equal(userFile(srv, KEA), true);
  srv.setServices({ ...srv.services, dhcp: { ...srv.services.dhcp, interfaces: ['eth0'] } });
  assert.match(cat(root, KEA), /"interfaces": \[ "eth0" \]/);
  assert.equal(userFile(srv, KEA), false);
});

type Saved = { devices: { id: string }[] };
const reload = (t: Topology, id: string): Server => Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())) as Saved).get(id)?.device as Server;

test('a loaded lab starts named with the saved files: a bad one leaves it failed, and the file stays', () => {
  const { t, srv, root } = lab();
  const local = cat(root, LOCAL);
  write(root, LOCAL, `${local}\nzone "rota.lab" {\n\ttype master\n};`);
  const again = reload(t, srv.id);
  const sh = createShell(again, 'linux', 'root');
  sh.run('export SYSTEMD_COLORS=0');
  assert.equal(sh.run('systemctl is-active named')[0], 'failed');
  assert.match(sh.run('journalctl -u named').join('\n'), /loading configuration: failure/);
  assert.match(cat(sh, LOCAL), /rota\.lab/);
});

test('a loaded lab with a good edited zone serves it; with named stopped the file stays as it was saved', () => {
  const { t, srv, root } = lab();
  write(root, DB, ZONE);
  const served = reload(t, srv.id);
  assert.deepEqual(served.services.dns.zones[0]?.records.find((r) => r.name === 'www')?.value, '192.168.10.81');
  srv.setUnit('dns', false);
  const stopped = reload(t, srv.id);
  const sh = createShell(stopped, 'linux', 'root');
  assert.match(cat(sh, DB), /192\.168\.10\.81/);
  assert.equal(userFile(stopped, DB), true);
});

test('in a loaded lab, a change from the interface writes the saved files again', () => {
  const { t, srv, root } = lab();
  write(root, DB, ZONE);
  srv.setUnit('dns', false);
  const again = reload(t, srv.id);
  addRecord(again, 'web', '192.168.10.90');
  const sh = createShell(again, 'linux', 'root');
  assert.match(cat(sh, DB), /192\.168\.10\.90/);
  assert.doesNotMatch(cat(sh, DB), /192\.168\.10\.81/);
});
