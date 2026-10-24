/**
 * Fidelity of what the tools show: TTL 64 for Linux hosts, the ICMP unreachable codes (net, host, port,
 * administratively prohibited) in ping and traceroute, ip addr show DEV, ss options, dig without a server, `>>`
 * without permission, IOS broadcast ping and tracert, and the kernel `log` line of nftables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import { Session } from '../../src/ios/session.ts';

function lab(id: string): Topology {
  const t = EXAMPLES.find((e) => e.id === id)?.build();
  assert.ok(t, `lab ${id}`);
  return t;
}

const shell = (t: Topology, label: string, user = 'alumno') => createShell(t.byLabel(label) as Pc, 'linux', user);

test('a Linux host answers with TTL 64 and a Windows one with TTL 128', () => {
  const t = lab('servidores');
  const sh = shell(t, 'PC1');
  assert.match(sh.run('ping -c 1 192.168.10.2').join('\n'), /from 192\.168\.10\.2: icmp_seq=1 ttl=64 /, 'Ubuntu server');
  assert.match(sh.run('ping -c 1 192.168.10.100').join('\n'), /from 192\.168\.10\.100: icmp_seq=1 ttl=128 /, 'Windows PC');
});

test('an IOS router without a route answers net unreachable: Linux ping shows Destination Net Unreachable', () => {
  const out = shell(lab('servidores'), 'PC1').run('ping -c 1 8.8.8.8').join('\n');
  assert.match(out, /From 192\.168\.10\.1 icmp_seq=1 Destination Net Unreachable/);
});

test('an IOS access list answers administratively prohibited: Linux ping shows Packet filtered', () => {
  const out = shell(lab('bastionado'), 'ALUMNO').run('ping -c 1 172.20.0.10').join('\n');
  assert.match(out, /From 192\.168\.20\.1 icmp_seq=1 Packet filtered/);
});

test('Linux traceroute marks a prohibited hop with !X (hop 1 is the TTL expiring before the outbound ACL)', () => {
  const out = shell(lab('bastionado'), 'ALUMNO').run('traceroute -n 172.20.0.10');
  assert.match(out.at(-1) ?? '', /^ 2 {2}192\.168\.20\.1 {2}[\d.]+ ms !X {2}[\d.]+ ms !X {2}[\d.]+ ms !X$/);
});

test('ip -4 addr show DEV lists only that interface and only its IPv4 lines', () => {
  const out = shell(lab('servidores'), 'PC1').run('ip -4 addr show eth0');
  assert.match(out[0] ?? '', /^2: eth0: </);
  assert.ok(!out.some((l) => /\blo\b|link\/ether/.test(l)), out.join('\n'));
  assert.ok(out.some((l) => /^ {4}inet 192\.168\.10\.50\/24 /.test(l)));
});

test('the nftables log line looks like the kernel one', () => {
  const t = lab('linux-dmz');
  shell(t, 'WEB-DMZ', 'admin').run('ping -c 1 -W 1 192.168.1.10');
  const log = shell(t, 'FW', 'root').run('dmesg | tail -1').join('\n');
  assert.match(log, /FW-DROP IN=eth2 OUT=eth1 MAC=([0-9a-f]{2}:){13}[0-9a-f]{2} SRC=172\.16\.0\.80 DST=192\.168\.1\.10 LEN=84 TOS=0x00 PREC=0x00 TTL=63 ID=\d+ DF PROTO=ICMP TYPE=8 CODE=0 ID=\d+ SEQ=1$/);
});

test('a reject in the forward chain answers from the router, with the ICMP type asked', () => {
  const t = lab('linux-dmz');
  const fw = shell(t, 'FW', 'root');
  fw.run('nft insert rule inet filter forward iifname "eth2" oifname "eth1" reject with icmp type admin-prohibited');
  assert.match(shell(t, 'WEB-DMZ', 'admin').run('ping -c 1 192.168.1.10').join('\n'), /From 172\.16\.0\.1 icmp_seq=1 Packet filtered/);
  fw.run('nft insert rule inet filter forward iifname "eth2" oifname "eth1" reject');
  assert.match(shell(t, 'WEB-DMZ', 'admin').run('ping -c 1 192.168.1.10').join('\n'), /From 172\.16\.0\.1 icmp_seq=1 Destination Port Unreachable/);
});

test('ip a s NAME and filter keywords work as in iproute2', () => {
  const sh = shell(lab('servidores'), 'PC1');
  assert.match(sh.run('ip a s eth0')[0] ?? '', /^2: eth0: </);
  assert.match(sh.run('ip addr sh dev eth0 scope global')[0] ?? '', /^2: eth0: </);
  assert.deepEqual(sh.run('ip a s eth9'), ['Device "eth9" does not exist.']);
});

test('the Internet answers net unreachable for an address nobody has', () => {
  assert.match(shell(lab('internet'), 'PC1').run('ping -c 2 11.22.33.44').join('\n'), /From 198\.51\.100\.2 icmp_seq=\d Destination Net Unreachable/);
});

function iosExec(t: Topology, label: string, line: string): string[] {
  const s = new Session(t.byLabel(label) as Router);
  s.mode = 'exec';
  return s.input(line);
}

test('IOS ping to a broadcast nobody answers: dots and a 0 percent success rate', () => {
  const out = iosExec(lab('basico'), 'GW', 'ping 192.168.10.255');
  assert.deepEqual(out.slice(-2), ['.....', 'Success rate is 0 percent (0/5)']);
});

test('tracert and IOS traceroute show who reported an unreachable', () => {
  const t = lab('basico');
  const win = createShell(t.byLabel('PC0') as Pc, 'windows', 'user').run('tracert -d 8.8.8.8');
  assert.ok(win.includes('  2  192.168.10.1  reports: Destination net unreachable.'), win.join('\n'));
  const ios = iosExec(lab('internet'), 'SEDE1', 'traceroute 11.22.33.44');
  assert.match(ios.at(-1) ?? '', /^ {2}\d 198\.51\.100\.2 !N {2}!N {2}!N$/, ios.join('\n'));
});

test('ss honours -t/-u, -l/-a and -p like iproute2', () => {
  const sh = shell(lab('servidores'), 'SRV', 'admin');
  const tln = sh.run('ss -tln');
  assert.match(tln[0] ?? '', /^State {2}Recv-Q Send-Q Local Address:Port {2}Peer Address:Port Process$/);
  assert.ok(tln.slice(1).every((l) => l.startsWith('LISTEN ') && !l.includes('users:')), tln.join('\n'));
  const all = sh.run('ss -tulpn');
  assert.match(all[0] ?? '', /^Netid State/);
  assert.ok(all.some((l) => /^udp {3}UNCONN .*:53 .*users:\(\("named"/.test(l)), all.join('\n'));
  assert.deepEqual(sh.run('ss -tn').length, 1, 'no -l: only established connections, none listed');
});

test('dig without a DNS server speaks like dig', () => {
  const t = lab('servidores');
  const pc = t.byLabel('PC1') as Pc;
  pc.setStatic({ ip: 0xc0a80a32, prefix: 24, gateway: 0xc0a80a01 });
  t.settle();
  const out = shell(t, 'PC1').run('dig +short srv.aula.lab');
  assert.ok(!out.join('\n').includes('no hay'), out.join('\n'));
  assert.match(out.join('\n'), /;; no servers could be reached/);
});

test('>> to a file without write permission fails when bash opens it', () => {
  const sh = shell(lab('servidores'), 'PC1');
  assert.deepEqual(sh.run('echo a >> /etc/passwd'), ['bash: /etc/passwd: Permission denied']);
  assert.deepEqual(sh.run('echo a >> /etc/resolv.conf'), ['bash: /etc/resolv.conf: Read-only file system']);
});

test('ss accepts -4 in a bundle and the long options', () => {
  const sh = shell(lab('servidores'), 'SRV', 'admin');
  assert.match(sh.run('ss -4tln')[0] ?? '', /^State /);
  assert.ok(sh.run('ss --tcp --listening --processes').some((l) => /users:\(\("sshd"/.test(l)));
});
