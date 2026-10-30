/**
 * NetBIOS over TCP/IP: Windows resolves single-label names by NBNS broadcast (UDP 137) after DNS, answers for its
 * own names, keeps a cache (nbtstat) and listens for SMB (139/445); GNU/Linux does with samba (nmbd, smbd, nmblookup)
 * and resolves through /etc/nsswitch.conf (wins with winbind; mdns4_minimal only with avahi / libnss-mdns).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { frameProtocol } from '../../src/net/packets.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const sh = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');

test('Windows finds another Windows by its bare name over NBNS broadcast, after DNS', () => {
  const t = lab('basico');
  const [pc0, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC2') as Host];
  const before = t.net.history.length;
  assert.match(win(pc0, 'ping -n 1 pc2'), /Pinging pc2 \[(\d+\.\d+\.\d+\.\d+)\] with 32 bytes of data:\n\nReply from \1/);
  const nbns = t.net.history.slice(before).filter((e) => frameProtocol(e.frame) === 'NBNS');
  const query = nbns.find((e) => !e.frame.ip?.udp?.nbns?.response);
  assert.equal(query?.frame.dst, 'ffffffffffff', 'a broadcast question');
  assert.equal(query?.frame.ip?.udp?.nbns?.name, 'PC2');
  assert.ok(nbns.some((e) => e.frame.ip?.udp?.nbns?.response && e.frame.dst !== 'ffffffffffff'), 'a unicast answer');
  assert.match(win(pc0, 'nbtstat -c'), /PC2 +<00> +UNIQUE +\d+\.\d+\.\d+\.\d+ +\d+/);
  assert.match(win(pc2, 'ping -n 1 nadie'), /could not find host nadie/);
});

test('nbtstat: local table, remote table by name and by address, purge', () => {
  const t = lab('basico');
  const pc0 = t.byLabel('PC0') as Host;
  const n = win(pc0, 'nbtstat -n');
  assert.match(n, /Node IpAddress: \[\d+\.\d+\.\d+\.\d+\] Scope Id: \[\]\n\n {16}NetBIOS Local Name Table\n\n {7}Name {15}Type {9}Status\n {4}-{45}\n {4}PC0 {12}<00>  UNIQUE {6}Registered\n {4}WORKGROUP {6}<00>  GROUP {7}Registered\n {4}PC0 {12}<20>  UNIQUE {6}Registered/);
  const a = win(pc0, 'nbtstat -a pc2');
  assert.match(a, /NetBIOS Remote Machine Name Table[\s\S]*PC2 {12}<20>  UNIQUE {6}Registered\n\n {4}MAC Address = ([0-9A-F]{2}-){5}[0-9A-F]{2}/);
  assert.match(win(pc0, 'nbtstat -a nadie'), /Host not found\./);
  assert.match(win(pc0, 'nbtstat -R'), /Successful purge and preload of the NBT Remote Cache Name Table\./);
  assert.match(win(pc0, 'nbtstat -c'), /No names in cache/);
});

test('samba: a GNU/Linux host answers NetBIOS and SMB; nmblookup; Windows cannot reach it without samba', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  assert.match(win(pc0, 'ping -n 1 pc1'), /could not find host pc1/);
  assert.match(win(pc0, 'net view \\\\pc1'), /System error 53 has occurred\.\n\nThe network path was not found\./);
  assert.match(sh(pc1, 'nmblookup pc0; echo "status $?"'), /nmblookup: command not found|Command 'nmblookup' not found/);
  assert.match(sh(pc1, 'apt install -y samba'), /Setting up samba \(/);
  assert.match(win(pc0, 'ping -n 1 pc1'), /Reply from /);
  assert.match(win(pc0, 'net view \\\\pc1'), /There are no entries in the list\./);
  assert.match(sh(pc1, 'nmblookup pc0'), /^querying pc0 on \d+\.\d+\.\d+\.255\n(\d+\.\d+\.\d+\.\d+) pc0<00>$/);
  assert.match(sh(pc1, 'nmblookup nadie; echo "status $?"'), /name_query failed to find name nadie\nstatus 1$/);
  assert.match(sh(pc1, `nmblookup -A ${win(pc0, 'ipconfig').match(/IPv4 Address[. ]*: ([\d.]+)/)?.[1]}`), /Looking up status of [\d.]+\n\tPC0 +<00> - +B <ACTIVE> \n\tWORKGROUP +<00> - <GROUP> B <ACTIVE> \n[\s\S]*MAC Address = /);
  assert.match(sh(pc1, 'nc -z -w 1 pc0.local 445 2>&1; true'), /.*/);
  const srv = t.byLabel('SRV-SEDE2') as Host;
  sh(srv, 'apt install -y samba');
  assert.match(win(pc0, 'ping -n 1 srv-sede2'), /could not find host srv-sede2/, 'NBNS broadcasts do not cross routers');
});

test('GNU/Linux follows /etc/nsswitch.conf: wins with winbind, mdns4_minimal only with avahi or libnss-mdns', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  assert.match(sh(pc1, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files dns$/);
  assert.match(sh(pc1, 'ping -c 1 pc0.local; echo "status $?"'), /status 2$/, 'no avahi: .local goes to the DNS');
  assert.match(sh(pc1, 'ping -c 1 pc0; echo "status $?"'), /status 2$/, 'no wins in nsswitch');
  sh(pc1, 'apt install -y winbind libnss-winbind; sed -i "s/^hosts:.*/hosts:          files dns wins/" /etc/nsswitch.conf');
  assert.match(sh(pc1, 'ping -c 1 pc0'), /1 received/, 'Windows answers NBNS');
  sh(pc1, 'apt install -y libnss-mdns');
  assert.match(sh(pc1, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files mdns4_minimal \[NOTFOUND=return\] dns wins$/, 'the postinst adds mdns4_minimal');
  assert.match(sh(pc1, 'ping -c 1 pc0.local'), /1 received/);
  sh(pc1, 'apt remove -y libnss-mdns');
  assert.match(sh(pc1, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files dns wins$/);
  pc1.os = 'windows';
  assert.match(sh(pc1, 'ping -c 1 pc0.local; echo "status $?"'), /status 2$/, 'from GNU/Linux mDNS always needs avahi, whatever the system');
  assert.match(win(pc1, 'ping -n 1 pc0.local'), /Reply from /, 'the Windows terminal asks natively');
});

test('SMB ports: Windows listens on 139 and 445; a GNU/Linux host only with samba', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  const ip0 = win(pc0, 'ipconfig').match(/IPv4 Address[. ]*: ([\d.]+)/)?.[1] ?? '';
  const ip1 = win(pc1, 'ipconfig').match(/IPv4 Address[. ]*: ([\d.]+)/)?.[1] ?? '';
  assert.match(sh(pc1, `nc -z -v -w 1 ${ip0} 445 2>&1`), /succeeded/);
  assert.match(sh(pc0, `nc -z -v -w 1 ${ip1} 445 2>&1`), /refused/);
  sh(pc1, 'apt install -y samba');
  assert.match(sh(pc0, `nc -z -v -w 1 ${ip1} 139 2>&1`), /succeeded/);
});

test('review: Windows curl and the browser resolve the Windows way; GNU/Linux curl still needs avahi', async () => {
  const { BrowserEngine } = await import('../../src/clients/browser.ts');
  const t = lab('basico');
  const [pc0, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC2') as Host];
  assert.match(win(pc0, 'curl -s http://pc2.local/'), /Failed to connect|Couldn't connect|Connection refused/i, 'resolved (no web server there)');
  assert.doesNotMatch(win(pc0, 'curl -s http://pc2/'), /Could not resolve host/, 'NetBIOS for a bare name');
  const page = new BrowserEngine(pc0).open('http://pc2.local/');
  assert.ok(page.kind !== 'error' || page.code !== 6, 'the browser of a Windows PC asks mDNS (code 6 = could not resolve)');
  assert.match(sh(pc0, 'curl -s http://pc2.local/; echo "status $?"'), /status 6$/, 'the GNU/Linux terminal of the same PC: no avahi, no .local');
});
