/**
 * WINS on Windows (h-node): the WINS server of the TCP/IP tab, or that of the DHCP lease (option 44), shows in
 * `ipconfig /all`; NetBT registers its names with it (when it is set, when the address changes and when a saved lab is
 * read back) and asks it first, so `ping` finds a name past the router.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setSambaInstalled } from '../../src/shells/samba-install.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Router } from '../../src/devices/router.ts';
import { Topology } from '../../src/net/topology.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { winsRecords } from '../../src/net/wins.ts';
import { setWinShareOn } from '../../src/net/win-shares.ts';
import { WINDOWS_WINS_TTL_S, setWindowsWins, validWins, windowsWinsManual, windowsWinsServers } from '../../src/net/win-wins.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');
const SRV_IP = ip('192.168.10.2');

/** nombres-redes with SRV serving WINS: WIN-A (LAN A) and WIN-B2 (LAN B, past GW), Windows both. */
function lab(): { t: Topology; srv: Host; winA: Host; b2: Host } {
  const t = EXAMPLES.find((e) => e.id === 'nombres-redes')!.build();
  const [srv, winA, b2] = ['SRV', 'WIN-A', 'WIN-B2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  setSambaInstalled(srv, true);
  createShell(srv, 'linux', 'root').run("printf '[global]\\n   wins support = yes\\n' > /etc/samba/smb.conf; systemctl restart nmbd");
  t.net.runFor(1000);
  return { t, srv, winA, b2 };
}

const names = (srv: Host): string[] => winsRecords(srv).map((r) => `${r.name}<${r.suffix.toString(16).padStart(2, '0')}>`);

test('ipconfig /all shows the WINS server only when there is one', () => {
  const { b2 } = lab();
  assert.doesNotMatch(win(b2, 'ipconfig /all'), /WINS/);
  assert.equal(setWindowsWins(b2, SRV_IP), true);
  assert.match(win(b2, 'ipconfig /all'), /   DNS Servers\.{21}: 192\.168\.10\.2\n   Primary WINS Server\.{13}: 192\.168\.10\.2\n/);
  assert.doesNotMatch(win(b2, 'ipconfig'), /WINS/, 'only with /all');
});

test('setting the WINS registers the names; ping from the other LAN finds them through it', () => {
  const { t, srv, winA, b2 } = lab();
  assert.match(win(winA, 'ping -n 1 win-b2'), /could not find host win-b2/, 'without WINS: the broadcast stays in LAN A');
  setWindowsWins(b2, SRV_IP);
  t.net.runFor(1000);
  assert.deepEqual(names(srv), ['WIN-B2<00>', 'WORKGROUP<00>'], 'no NAME<20> while it shares nothing');
  const granted = winsRecords(srv)[0]?.expires ?? 0;
  assert.ok(Math.abs(granted - t.clock.now() - WINDOWS_WINS_TTL_S * 1000) < 5000, 'Windows asks for 300 000 s');
  setWindowsWins(winA, SRV_IP);
  assert.match(win(winA, 'ping -n 1 win-b2'), /Pinging win-b2 \[192\.168\.20\.12\][\s\S]*Reply from 192\.168\.20\.12/);
});

test('NetBT refreshes its names at half the TTL the server granted', () => {
  const { t, srv, b2 } = lab();
  setWindowsWins(b2, SRV_IP);
  t.net.runFor(1000);
  const first = winsRecords(srv)[0]?.expires ?? 0;
  t.net.runFor((WINDOWS_WINS_TTL_S / 2) * 1000 - 60_000);
  assert.equal(winsRecords(srv)[0]?.expires, first, 'not yet');
  t.net.runFor(120_000);
  assert.ok((winsRecords(srv)[0]?.expires ?? 0) > first + 86_400_000, 'refreshed');
  setWindowsWins(b2, undefined);
  t.net.runFor(WINDOWS_WINS_TTL_S * 1000);
  assert.deepEqual(names(srv), [], 'no WINS: no more refreshes, so the names expire');
});

test('a new address registers again; any other change sends nothing', () => {
  const { t, srv, b2 } = lab();
  setWindowsWins(b2, SRV_IP);
  t.net.runFor(1000);
  const sent = (): number => t.net.history.filter((e) => e.frame.ip?.udp?.nbns?.opcode === 'registration' && !e.frame.ip.udp.nbns.response).length;
  const before = sent();
  b2.notifyChange();
  setWindowsWins(b2, SRV_IP);
  t.net.runFor(1000);
  assert.equal(sent(), before, 'same address, same server');
  b2.setStatic({ ...b2.config, ip: ip('192.168.20.13') });
  t.net.runFor(1000);
  assert.deepEqual(winsRecords(srv).find((r) => r.name === 'WIN-B2' && r.suffix === 0)?.ips, [ip('192.168.20.13')]);
  b2.os = 'linux';
  b2.setStatic({ ...b2.config, ip: ip('192.168.20.14') });
  t.net.runFor(1000);
  assert.deepEqual(winsRecords(srv).find((r) => r.name === 'WIN-B2' && r.suffix === 0)?.ips, [ip('192.168.20.13')], 'GNU/Linux uses smb.conf');
});

test('option 44 of an IOS pool is the WINS of a DHCP client; one typed in wins over it', () => {
  const { t, srv, b2 } = lab();
  applyConfig(t.byLabel('GW') as Router, ['ip dhcp excluded-address 192.168.20.1 192.168.20.99', 'ip dhcp pool LAN-B', ' network 192.168.20.0 255.255.255.0', ' default-router 192.168.20.1', ' netbios-name-server 192.168.10.2 192.168.10.3']);
  b2.useDhcp();
  t.net.runFor(10_000);
  assert.deepEqual(b2.dhcpClient.lease?.winsServers, [SRV_IP, ip('192.168.10.3')]);
  assert.match(win(b2, 'ipconfig /all'), /Primary WINS Server\.+: 192\.168\.10\.2\n   Secondary WINS Server\.{11}: 192\.168\.10\.3\n/);
  assert.deepEqual(winsRecords(srv).find((r) => r.name === 'WIN-B2' && r.suffix === 0)?.ips, [b2.config.ip]);
  setWindowsWins(b2, ip('192.168.10.9'));
  assert.match(win(b2, 'ipconfig /all'), /Primary WINS Server\.+: 192\.168\.10\.9\n/);
  assert.doesNotMatch(win(b2, 'ipconfig /all'), /Secondary WINS/, 'the one typed in, alone');
});

test('NetBT keeps two WINS servers of the lease, however many come', () => {
  const { t, b2 } = lab();
  const many = Array.from({ length: 6 }, (_, i) => `192.168.10.${i + 2}`).join(' ');
  applyConfig(t.byLabel('GW') as Router, ['ip dhcp excluded-address 192.168.20.1 192.168.20.99', 'ip dhcp pool LAN-B', ' network 192.168.20.0 255.255.255.0', ' default-router 192.168.20.1', ` netbios-name-server ${many}`]);
  b2.useDhcp();
  t.net.runFor(10_000);
  assert.deepEqual(windowsWinsServers(b2), [SRV_IP, ip('192.168.10.3')]);
});

test('only a unicast address can be the WINS server', () => {
  const { b2 } = lab();
  for (const bad of ['0.0.0.0', '255.255.255.255', '224.0.0.251']) {
    assert.equal(validWins(parseIp(bad)), false, bad);
    assert.equal(setWindowsWins(b2, parseIp(bad) ?? 0), false, bad);
  }
  assert.equal(validWins(null), false);
  assert.equal(windowsWinsManual(b2), undefined);
  setWindowsWins(b2, SRV_IP);
  setWindowsWins(b2, undefined);
  assert.equal(windowsWinsManual(b2), undefined);
});

test('a saved lab keeps the WINS, registers again, and a file with anything else in it has none', () => {
  const { t, b2 } = lab();
  setWinShareOn(b2, true);
  setWindowsWins(b2, SRV_IP);
  t.net.runFor(1000);
  const json = t.toJSON();
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(json)));
  back.net.runFor(1000);
  assert.equal(windowsWinsManual(back.byLabel('WIN-B2') as Host), SRV_IP);
  assert.deepEqual(names(back.byLabel('SRV') as Host), ['WIN-B2<00>', 'WIN-B2<20>', 'WORKGROUP<00>']);
  const text = JSON.stringify(json);
  for (const bad of ['"nadie"', '"255.255.255.255"', '12', '{"x":1}']) {
    const odd = Topology.fromJSON(JSON.parse(text.replace('"wins":"192.168.10.2"', `"wins":${bad}`)));
    assert.equal(windowsWinsManual(odd.byLabel('WIN-B2') as Host), undefined, bad);
  }
});
