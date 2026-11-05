/**
 * WINS: nmbd with `wins support = yes` keeps the names its clients register by unicast, across the router, and answers
 * their queries (NAM_ERR when nobody has the name). A client with `wins server = IP` registers its three names as nmbd
 * starts, refreshes them every 20 minutes and releases them as it stops; a name nobody refreshes expires.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setSambaInstalled } from '../../src/shells/samba-install.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';
import { Topology } from '../../src/net/topology.ts';
import { MAX_WINS_RECORDS, NAM_ERR, RFS_ERR, WINS_MAX_TTL_S, isWinsServer, winsAsk, winsRecords, winsSend } from '../../src/net/wins.ts';
import type { NbnsMessage } from '../../src/net/packets.ts';

const run = (h: Host, cmd: string): string => createShell(h, 'linux', 'root').run(cmd).join('\n');
const SRV_IP = parseIp('192.168.10.2') ?? 0;
const B2_IP = parseIp('192.168.20.12') ?? 0;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function smbConf(h: Host, body: string): void {
  run(h, `printf '[global]\\n   workgroup = WORKGROUP\\n${body}\\n' > /etc/samba/smb.conf; systemctl restart nmbd`);
}

/** nombres-redes: SRV (LAN A) the WINS server, WIN-B2 (LAN B, past GW) a GNU/Linux client with samba. */
function lab(): { t: Topology; srv: Host; winB: Host; b2: Host } {
  const t = EXAMPLES.find((e) => e.id === 'nombres-redes')!.build();
  const [srv, winB, b2] = ['SRV', 'WIN-B', 'WIN-B2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  setSambaInstalled(srv, true);
  smbConf(srv, '   wins support = yes');
  b2.os = 'linux';
  setSambaInstalled(b2, true);
  smbConf(b2, '   wins server = 192.168.10.2');
  t.net.runFor(1000);
  return { t, srv, winB, b2 };
}

const names = (srv: Host): string[] => winsRecords(srv).map((r) => `${r.name}<${r.suffix.toString(16).padStart(2, '0')}>`);

test('a client registers its names with the WINS server as nmbd starts, across the router', () => {
  const { srv } = lab();
  assert.equal(isWinsServer(srv), true);
  assert.deepEqual(names(srv), ['WIN-B2<00>', 'WIN-B2<20>', 'WORKGROUP<00>']);
  assert.deepEqual(winsRecords(srv).find((r) => r.suffix === 0 && !r.group)?.ips, [B2_IP]);
  assert.deepEqual(winsRecords(srv).find((r) => r.group)?.ips, [0xffffffff], 'a group name is kept as the broadcast address');
});

test('a unicast query from another subnet gets the address; an unknown name gets NAM_ERR', () => {
  const { winB } = lab();
  const found = winsAsk(winB, SRV_IP, 'win-b2', 0);
  assert.equal(found?.rcode ?? 0, 0);
  assert.deepEqual(found?.addresses, [B2_IP]);
  assert.ok((found?.ttl ?? 0) > 0);
  assert.equal(winsAsk(winB, SRV_IP, 'NADIE', 0)?.rcode, NAM_ERR);
  assert.deepEqual(winsAsk(winB, SRV_IP, 'SRV', 0)?.addresses, [SRV_IP], 'the server answers for its own names');
});

test('stopping nmbd releases the names; a stopped server does not answer and forgets them', () => {
  const { t, srv, winB, b2 } = lab();
  winsSend(winB, SRV_IP, 'release', { name: 'WIN-B2', suffix: 0, group: false }, 0);
  t.net.runFor(1000);
  assert.equal(names(srv).length, 3, 'only the owner releases a unique name');
  run(b2, 'systemctl stop nmbd');
  t.net.runFor(1000);
  assert.deepEqual(names(srv), ['WORKGROUP<00>'], 'a group name stays until nobody refreshes it');
  assert.equal(winsAsk(winB, SRV_IP, 'WIN-B2', 0)?.rcode, NAM_ERR);
  run(b2, 'systemctl start nmbd');
  t.net.runFor(1000);
  assert.equal(names(srv).length, 3);
  run(srv, 'systemctl stop nmbd');
  assert.equal(isWinsServer(srv), false);
  assert.equal(winsAsk(winB, SRV_IP, 'WIN-B2', 0), undefined, 'nobody answers');
  run(srv, 'systemctl start nmbd');
  assert.deepEqual(names(srv), [], 'no wins.dat: an empty database');
});

test('the client refreshes every 20 minutes; a name nobody refreshes expires', () => {
  const { t, srv, winB } = lab();
  const first = winsRecords(srv)[0]?.expires ?? 0;
  assert.ok(Math.abs(first - t.clock.now() - 3 * DAY_MS) < 5000, 'Samba asks for 3 days and gets them');
  t.clock.set(t.clock.now() + 2 * DAY_MS);
  t.net.runFor(21 * 60_000);
  assert.ok((winsRecords(srv)[0]?.expires ?? 0) > first + DAY_MS, 'refreshed');
  const now = t.clock.now();
  winsSend(winB, SRV_IP, 'registration', { name: 'TEMPORAL', suffix: 0, group: false }, 60);
  t.net.runFor(1000);
  const temporal = winsRecords(srv).find((r) => r.name === 'TEMPORAL');
  assert.ok(Math.abs((temporal?.expires ?? 0) - now - 6 * HOUR_MS) < 5000, 'at least 6 hours');
  t.clock.set(now + 7 * HOUR_MS);
  assert.equal(winsRecords(srv).find((r) => r.name === 'TEMPORAL'), undefined, 'nobody refreshed it');
  assert.equal(names(srv).length, 3, 'WIN-B2 still refreshes its own');
});

test('a server grants at most 6 days and refuses names past its limit with RFS_ERR', () => {
  const { t, srv, winB } = lab();
  let granted: NbnsMessage | undefined;
  winsSend(winB, SRV_IP, 'registration', { name: 'LARGO', suffix: 0, group: false }, 30 * 86_400, (m) => { granted = m; });
  t.net.runFor(1000);
  assert.equal(granted?.ttl, WINS_MAX_TTL_S);
  winsSend(winB, SRV_IP, 'registration', { name: 'RARO', suffix: 0, group: false }, Number.NaN, (m) => { granted = m; });
  t.net.runFor(1000);
  assert.equal(granted?.ttl, WINS_MAX_TTL_S, 'not a number: the most, and it still expires');
  const answers: (NbnsMessage | undefined)[] = [];
  for (let i = 0; i < MAX_WINS_RECORDS; i++) winsSend(winB, SRV_IP, 'registration', { name: `N${i}`, suffix: 0, group: false }, 3600, (m) => answers.push(m));
  t.net.runFor(3000);
  assert.equal(winsRecords(srv).length, MAX_WINS_RECORDS);
  assert.equal(answers.filter((m) => m?.rcode === RFS_ERR).length, 5, 'the three names of WIN-B2, LARGO and RARO were there first');
});

test('however often nmbd restarts, one refresh every 20 minutes', () => {
  const { t, b2 } = lab();
  for (let i = 0; i < 5; i++) run(b2, 'systemctl restart nmbd');
  t.net.runFor(1000);
  const before = t.net.history.length;
  t.net.runFor(20 * 60_000);
  const refreshes = t.net.history.slice(before).filter((e) => e.frame.ip?.udp?.nbns?.opcode === 'refresh' && !e.frame.ip.udp.nbns.response && e.frame.ip.src === B2_IP);
  assert.equal(new Set(refreshes.map((e) => e.frame.ip?.udp?.nbns?.id)).size, 3);
});

test('a dead first server in the list: the client registers with the next one', () => {
  const { t, srv, b2 } = lab();
  smbConf(b2, '   wins server = 192.168.10.99, 192.168.10.2');
  t.net.runFor(5000);
  assert.deepEqual(names(srv), ['WIN-B2<00>', 'WIN-B2<20>', 'WORKGROUP<00>']);
});

test('a saved lab comes back with its clients registered again', () => {
  const { t } = lab();
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const srv = back.byLabel('SRV') as Host;
  assert.equal(isWinsServer(srv), true);
  assert.deepEqual(names(srv), ['WIN-B2<00>', 'WIN-B2<20>', 'WORKGROUP<00>']);
});
