/** Packages apt installs on any GNU/Linux host: nmcli (NetworkManager) and mDNS (avahi-daemon, libnss-mdns). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { frameProtocol } from '../../src/net/packets.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));

test('nmcli is not there until network-manager is installed, and stays installed in the file', () => {
  const t = lab('internet');
  const pc = t.byLabel('PC1') as Host;
  assert.match(run(pc, 'nmcli; echo "status $?"'), /^Command 'nmcli' not found, but can be installed with:\nsudo apt install network-manager\nstatus 127$/);
  assert.match(run(pc, 'apt install -y network-manager'), /Setting up network-manager \(/);
  assert.match(run(pc, 'nmcli --version'), /^nmcli tool, version 1\.\d+\.\d+/);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.match(run(again.byLabel('PC1') as Host, 'nmcli networking'), /^enabled$/);
});

test('nmcli: device status, device show, connection show and the overview, from the real configuration', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y network-manager');
  assert.match(run(pc, 'nmcli device status'), /^DEVICE +TYPE +STATE +CONNECTION *\neth0 +ethernet +connected +netplan-eth0 *\nlo +loopback +connected \(externally\) +lo *$/);
  assert.equal(run(pc, 'nmcli d'), run(pc, 'nmcli device status'), 'abbreviations');
  const show = run(pc, 'nmcli device show eth0');
  assert.match(show, /^GENERAL\.DEVICE: {25}eth0\nGENERAL\.TYPE: {27}ethernet\nGENERAL\.HWADDR: {25}([0-9A-F]{2}:){5}[0-9A-F]{2}\n/, 'labels padded to 40');
  assert.match(show, /IP4\.ADDRESS\[1\]: +\d+\.\d+\.\d+\.\d+\/\d+\nIP4\.GATEWAY: +\d+\.\d+\.\d+\.\d+\n/);
  assert.match(show, /IP4\.ROUTE\[\d\]: +dst = 0\.0\.0\.0\/0, nh = \d+\.\d+\.\d+\.\d+, mt = 100/);
  assert.match(show, /IP4\.DNS\[1\]: +\d+\.\d+\.\d+\.\d+/);
  assert.match(run(pc, 'nmcli connection show'), /^NAME +UUID +TYPE +DEVICE *\nnetplan-eth0 +[0-9a-f-]{36} +ethernet +eth0 *\nlo +[0-9a-f-]{36} +loopback +lo *$/);
  assert.match(run(pc, 'nmcli con show netplan-eth0'), /connection\.id: +netplan-eth0\n[\s\S]*ipv4\.method: +(auto|manual)\n/);
  const overview = run(pc, 'nmcli');
  assert.match(overview, /^eth0: connected to netplan-eth0\n\t"Intel 82540EM"\n\tethernet \(e1000\), ([0-9A-F]{2}:){5}[0-9A-F]{2}, hw, mtu 1500\n\tip4 default\n\tinet4 /);
  assert.match(overview, /DNS configuration:\n\tservers: [\d.]+\n/);
  assert.match(run(pc, 'nmcli device show eth9; echo "status $?"'), /^Error: Device 'eth9' not found\.\nstatus 10$/);
  assert.match(run(pc, 'nmcli foo; echo "status $?"'), /^Error: Object 'foo' is unknown, try 'nmcli help'\.\nstatus 2$/);
});

test('nmcli general: connectivity checked for real (full with Internet, limited without)', () => {
  const online = lab('internet').byLabel('PC1') as Host;
  run(online, 'apt install -y network-manager');
  assert.match(run(online, 'nmcli general status'), /^STATE +CONNECTIVITY +WIFI-HW +WIFI +WWAN-HW +WWAN +METERED *\nconnected +full +missing +enabled +missing +enabled +no \(guessed\) *$/);
  const t = lab('internet');
  const pc = t.byLabel('PC1') as Host;
  run(pc, 'apt install -y network-manager; ip route del default');
  assert.match(run(pc, 'nmcli g'), /\nconnected \(site only\) +limited /);
});

test('mDNS: with avahi on both ends, ping by name.local on the same switch, as multicast on the wire', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  pc0.os = 'linux';
  assert.match(run(pc1, 'ping -c 1 pc0.local; echo "status $?"'), /status 2$/, 'no mDNS yet');
  for (const pc of [pc0, pc1]) run(pc, 'apt install -y avahi-daemon');
  const before = t.net.history.length;
  assert.match(run(pc1, 'ping -c 1 pc0.local'), /^PING pc0\.local \((\d+\.\d+\.\d+\.\d+)\) 56\(84\) bytes of data\.\n64 bytes from pc0\.local \(\1\): icmp_seq=1 ttl=64/);
  const mdns = t.net.history.slice(before).filter((e) => e.frame.ip?.udp?.dport === 5353);
  assert.ok(mdns.some((e) => e.frame.dst === '01005e0000fb' && e.frame.ip?.dst === 0xe00000fb), 'a multicast query');
  assert.equal(frameProtocol(mdns[0]!.frame), 'MDNS');
  assert.match(run(pc0, 'ping -c 1 pc1.local'), /1 received/);
});

test('mDNS stays on its link, needs avahi on the other end, and nftables can block it', () => {
  const t = lab('internet');
  const [pc1, srv] = [t.byLabel('PC1') as Host, t.byLabel('SRV-SEDE2') as Host];
  for (const h of [pc1, srv]) run(h, 'apt install -y avahi-daemon');
  assert.match(run(pc1, 'ping -c 1 srv-sede2.local; echo "status $?"'), /status 2$/, 'another site: no multicast across routers');
  const pc0 = t.byLabel('PC0') as Host;
  pc0.os = 'linux';
  run(pc0, 'apt install -y libnss-mdns');
  assert.match(run(pc1, 'ping -c 1 pc0.local; echo "status $?"'), /status 2$/, 'libnss-mdns only asks; avahi-daemon answers');
  assert.match(run(pc0, 'ping -c 1 pc1.local'), /1 received/, 'it can ask, though');
  run(pc1, 'nft add table inet f; nft add chain inet f input "{ type filter hook input priority 0; policy accept; }"; nft add rule inet f input udp dport 5353 drop');
  assert.match(run(pc0, 'ping -c 1 pc1.local; echo "status $?"'), /status 2$/, 'the firewall drops the question');
});

test('review: nmcli -t, -f and -g for scripts; every profile listed; eth1 is not eth10', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y network-manager');
  assert.match(run(pc, 'nmcli -g IP4.ADDRESS dev show eth0'), /^\d+\.\d+\.\d+\.\d+\/\d+$/);
  assert.match(run(pc, 'nmcli -t -f DEVICE,STATE device'), /^eth0:connected\nlo:connected \(externally\)$/);
  assert.match(run(pc, 'nmcli -f GENERAL.STATE device show eth0'), /^GENERAL\.STATE: +100 \(connected\)$/);
  assert.match(run(pc, 'nmcli -t -f NAME,TYPE c'), /^netplan-eth0:802-3-ethernet\nlo:loopback$/);
  assert.match(run(pc, 'nmcli networking connectivity'), /^full$/);
  assert.match(run(pc, 'nmcli general hostname'), /^pc1$/);
  const fw = lab('linux-dmz').byLabel('FW') as Host;
  run(fw, 'apt install -y network-manager; ip link set eth2 down');
  assert.match(run(fw, 'nmcli connection show'), /netplan-eth2 +[0-9a-f-]{36} +ethernet +-- /, 'a profile without its device');
  assert.doesNotMatch(run(fw, 'nmcli dev show eth1'), /dev eth1\d/);
});

const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');

test('Windows has mDNS built in: it answers to NAME.local and asks for .local names, with nothing installed', () => {
  const t = lab('basico');
  const [pc0, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC2') as Host];
  assert.equal(pc0.os, 'windows');
  const before = t.net.history.length;
  assert.match(win(pc0, 'ping -n 1 pc2.local'), /Pinging pc2\.local \[(\d+\.\d+\.\d+\.\d+)\] with 32 bytes of data:\n\nReply from \1: bytes=32/);
  const mdns = t.net.history.slice(before).filter((e) => e.frame.ip?.udp?.dns && (e.frame.ip.udp.dport === 5353 || e.frame.ip.udp.sport === 5353));
  assert.ok(mdns.some((e) => e.frame.ip?.udp?.dns?.response && e.frame.dst === '01005e0000fb'), 'Windows asks from 5353: the answer is multicast');
  assert.ok(mdns.every((e) => e.frame.ip?.udp?.sport === 5353), 'both ends use 5353');
  assert.match(win(pc0, 'nslookup pc2.local'), /can't find pc2\.local|Non-existent domain|timed out/i, 'nslookup asks the DNS server, as on Windows');
});

test('Windows and GNU/Linux with avahi find each other; Windows does not cross routers either', () => {
  const t = lab('internet');
  const [pc0, pc1, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host, t.byLabel('PC2') as Host];
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /could not find host pc1\.local/, 'the GNU/Linux PC needs avahi to answer');
  run(pc1, 'apt install -y avahi-daemon');
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /Reply from /);
  assert.match(run(pc1, 'ping -c 1 pc0.local'), /1 received/, 'Windows answers the GNU/Linux query (unicast to its port)');
  assert.match(win(pc0, 'ping -n 1 pc2.local'), /could not find host pc2\.local/, 'PC2 is behind a router');
});

test('review: a multicast answer for another name is not taken by a host waiting on 5353', () => {
  const t = lab('basico');
  const [pc0, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC2') as Host];
  const before = t.net.history.length;
  // PC2's own question goes out; while it waits, PC0 answers for itself, not for the name PC2 asked.
  assert.match(win(pc2, 'ping -n 1 nadie.local'), /could not find host nadie\.local/);
  assert.match(win(pc2, 'ping -n 1 pc0.local'), /Reply from /);
  assert.ok(t.net.history.length > before);
});
