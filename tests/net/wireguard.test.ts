/** WireGuard between two GNU/Linux routers: wg/wg-quick, cryptokey routing, NAT traversal and keepalive. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

interface Site { lr: LinuxRouter; pc: Pc; priv: string; pub: string }

function site(t: Topology, lan: string, wan: string, gw?: string): Site {
  const lr = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  const root = createShell(lr, 'linux', 'root');
  root.run(`ip addr add ${wan} dev eth0; ip addr add ${lan}.1/24 dev eth1; sysctl -w net.ipv4.ip_forward=1${gw ? `; ip route add default via ${gw}` : ''}`);
  pc.setStatic({ ip: ip(`${lan}.10`), prefix: 24, gateway: ip(`${lan}.1`) });
  const priv = all(root.run('umask 077; wg genkey | tee /etc/wireguard/private.key')).trim();
  const pub = all(root.run('wg pubkey < /etc/wireguard/private.key')).trim();
  return { lr, pc, priv, pub };
}

function conf(me: Site, tunnel: string, peer: Site, allowed: string, extra = ''): string {
  return `[Interface]\nAddress = ${tunnel}/24\nListenPort = 51820\nPrivateKey = ${me.priv}\n\n[Peer]\nPublicKey = ${peer.pub}\nAllowedIPs = ${allowed}\n${extra}`;
}

function write(s: Site, text: string): string[] {
  return createShell(s.lr, 'linux', 'root').run(`cat > /etc/wireguard/wg0.conf <<'EOF'\n${text}\nEOF\nchmod 600 /etc/wireguard/wg0.conf\nwg-quick up wg0`);
}

/** A eth0 203.0.113.1 ── B eth0 203.0.113.2 (back to back) */
function direct(): { t: Topology; a: Site; b: Site } {
  const t = new Topology();
  const a = site(t, '192.168.1', '203.0.113.1/24');
  const b = site(t, '192.168.2', '203.0.113.2/24');
  t.connect({ device: a.lr.id, port: 'GigabitEthernet0/0' }, { device: b.lr.id, port: 'GigabitEthernet0/0' });
  t.settle();
  return { t, a, b };
}

const ping = (pc: Pc, dst: string, n = 3): string => all(createShell(pc, 'linux').run(`ping -c ${n} ${dst}`));

test('wg-quick up prints its steps, creates wg0 and the AllowedIPs routes', () => {
  const { a, b } = direct();
  const out = all(write(a, conf(a, '10.10.0.1', b, '10.10.0.2/32, 192.168.2.0/24', 'Endpoint = 203.0.113.2:51820')));
  assert.equal(out, ['[#] ip link add wg0 type wireguard', '[#] wg setconf wg0 /dev/fd/63', '[#] ip -4 address add 10.10.0.1/24 dev wg0', '[#] ip link set mtu 1420 up dev wg0', '[#] ip -4 route add 192.168.2.0/24 dev wg0'].join('\n'));
  const root = createShell(a.lr, 'linux', 'root');
  assert.match(all(root.run('ip -br a')), /wg0 +UNKNOWN +10\.10\.0\.1\/24 /);
  assert.match(all(root.run('ip a show')), /5: wg0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN group default qlen 1000\n {4}link\/none \n {4}inet 10\.10\.0\.1\/24 scope global wg0/);
  assert.match(all(root.run('ip route')), /10\.10\.0\.0\/24 dev wg0 proto kernel scope link src 10\.10\.0\.1\n192\.168\.1\.0\/24 dev eth1[^\n]*\n192\.168\.2\.0\/24 dev wg0 scope link/);
  assert.equal(all(root.run('wg show wg0 public-key')), a.pub);
  assert.match(all(root.run('wg')), new RegExp(`^interface: wg0\\n  public key: ${a.pub.replace(/[+/]/g, '\\$&')}\\n  private key: \\(hidden\\)\\n  listening port: 51820\\n\\npeer: .*\\n  endpoint: 203\\.0\\.113\\.2:51820\\n  allowed ips: 10\\.10\\.0\\.2/32, 192\\.168\\.2\\.0/24$`));
  assert.match(all(root.run('wg-quick up wg0 2>&1')), /wg-quick: `wg0' already exists/);
  assert.match(all(createShell(a.lr, 'linux').run('wg show 2>&1')), /Operation not permitted/);
});

test('site-to-site: LAN to LAN through the tunnel, handshake and transfer counters', () => {
  const { a, b } = direct();
  write(a, conf(a, '10.10.0.1', b, '10.10.0.2/32, 192.168.2.0/24', 'Endpoint = 203.0.113.2:51820'));
  write(b, conf(b, '10.10.0.2', a, '10.10.0.1/32, 192.168.1.0/24', 'Endpoint = 203.0.113.1:51820'));
  assert.match(ping(a.pc, '192.168.2.10', 4), /[34] received/);
  assert.match(ping(a.pc, '192.168.2.10'), / 0% packet loss/);
  assert.match(all(createShell(a.lr, 'linux', 'root').run('ping -c 2 10.10.0.2')), / 0% packet loss/);
  const show = all(createShell(b.lr, 'linux', 'root').run('wg show wg0'));
  assert.match(show, /latest handshake: (Now|\d+ seconds? ago)/);
  assert.match(show, /transfer: [\d.]+ (B|KiB) received, [\d.]+ (B|KiB) sent/);
  assert.match(all(createShell(a.pc, 'linux').run('traceroute -n 192.168.2.10')), /1 {2}192\.168\.1\.1 [\s\S]*2 {2}10\.10\.0\.2 [\s\S]*3 {2}192\.168\.2\.10 /);
});

test('a key mismatch never completes the handshake; wg-quick down removes everything', () => {
  const { a, b } = direct();
  write(a, conf(a, '10.10.0.1', b, '10.10.0.2/32, 192.168.2.0/24', 'Endpoint = 203.0.113.2:51820'));
  write(b, conf(b, '10.10.0.2', { ...a, pub: b.pub }, '10.10.0.1/32, 192.168.1.0/24'));
  assert.match(ping(a.pc, '192.168.2.10'), /100% packet loss/);
  const root = createShell(a.lr, 'linux', 'root');
  assert.doesNotMatch(all(root.run('wg show wg0')), /latest handshake/);
  assert.equal(all(root.run('wg-quick down wg0 2>&1')), '[#] ip link delete dev wg0');
  assert.doesNotMatch(all(root.run('ip a; ip route')), /wg0/);
  assert.match(all(root.run('wg-quick down wg0 2>&1')), /`wg0' is not a WireGuard interface/);
});

test('NAT traversal: the branch behind PAT keeps the tunnel alive and the hub learns its endpoint', () => {
  const t = new Topology();
  const hub = site(t, '192.168.1', '203.0.113.1/30');
  const branch = site(t, '192.168.2', '10.0.0.2/24', '10.0.0.1');
  const nat = t.add('router', 0, 0).device as Router;
  t.connect({ device: hub.lr.id, port: 'GigabitEthernet0/0' }, { device: nat.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: branch.lr.id, port: 'GigabitEthernet0/0' }, { device: nat.id, port: 'GigabitEthernet0/0' });
  const s = new Session(nat);
  s.mode = 'config';
  ['interface g0/0', 'ip address 10.0.0.1 255.255.255.0', 'ip nat inside', 'no shutdown', 'interface g0/1', 'ip address 203.0.113.2 255.255.255.252', 'ip nat outside', 'no shutdown', 'exit',
    'access-list 1 permit 10.0.0.0 0.0.0.255', 'ip nat inside source list 1 interface g0/1 overload'].forEach((l) => s.input(l));
  t.settle();
  write(hub, conf(hub, '10.10.0.1', branch, '10.10.0.2/32, 192.168.2.0/24'));
  write(branch, conf(branch, '10.10.0.2', hub, '10.10.0.1/32, 192.168.1.0/24', 'Endpoint = 203.0.113.1:51820\nPersistentKeepalive = 25'));
  t.settle(30_000);
  const show = all(createShell(hub.lr, 'linux', 'root').run('wg show wg0 endpoints'));
  assert.match(show, /\t203\.0\.113\.2:\d+$/, 'the hub sees the public address of the NAT');
  assert.match(ping(hub.pc, '192.168.2.10'), / 0% packet loss/, 'the hub reaches the branch LAN with no Endpoint configured');
  assert.match(all(createShell(branch.lr, 'linux', 'root').run('wg show wg0')), /persistent keepalive: every 25 seconds/);
});

test('wg set, showconf, strip and config errors', () => {
  const { a, b } = direct();
  const root = createShell(a.lr, 'linux', 'root');
  root.run('ip link add dev wg1 type wireguard');
  assert.equal(all(root.run(`wg set wg1 listen-port 51821 private-key /etc/wireguard/private.key peer ${b.pub} allowed-ips 10.20.0.0/24 endpoint 203.0.113.2:51821 persistent-keepalive 15`)), '');
  assert.equal(all(root.run('wg showconf wg1')), `[Interface]\nListenPort = 51821\nPrivateKey = ${a.priv}\n\n[Peer]\nPublicKey = ${b.pub}\nAllowedIPs = 10.20.0.0/24\nEndpoint = 203.0.113.2:51821\nPersistentKeepalive = 15`);
  assert.match(all(root.run(`wg set wg1 peer ${b.pub} remove; wg show wg1 peers`)), /^$/);
  assert.match(all(root.run('wg set wg1 peer xyz 2>&1')), /Key is not the correct length or format: `xyz'/);
  root.run(`printf '[Interface]\\nAddress = 10.30.0.1/24\\nFoo = bar\\n' > /etc/wireguard/wg2.conf`);
  assert.match(all(root.run('wg-quick up wg2 2>&1')), /Line unrecognized: `Foo=bar'\nConfiguration parsing error/);
  assert.match(all(root.run('wg-quick up wg9 2>&1')), /`\/etc\/wireguard\/wg9\.conf' does not exist/);
  assert.match(all(root.run('echo bad | wg pubkey 2>&1')), /Key is not the correct length or format/);
  write(a, conf(a, '10.10.0.1', b, '192.168.2.0/24'));
  assert.doesNotMatch(all(root.run('wg-quick strip wg0')), /Address/);
  assert.match(all(root.run('wg frob 2>&1')), /Invalid subcommand: `frob'/);
});

test('systemctl enable --now wg-quick@wg0 brings it up and a saved topology boots it again', () => {
  const { t, a, b } = direct();
  write(b, conf(b, '10.10.0.2', a, '10.10.0.1/32, 192.168.1.0/24', 'Endpoint = 203.0.113.1:51820'));
  for (const s of [a, b]) createShell(s.lr, 'linux', 'root').run("echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-forward.conf");
  createShell(b.lr, 'linux', 'root').run('systemctl enable wg-quick@wg0');
  const root = createShell(a.lr, 'linux', 'root');
  const text = conf(a, '10.10.0.1', b, '10.10.0.2/32, 192.168.2.0/24', 'Endpoint = 203.0.113.2:51820').replace('\n\n[Peer]', '\nPostUp = nft add table inet wg_%i\nPostDown = nft delete table inet wg_%i\n\n[Peer]');
  root.run(`cat > /etc/wireguard/wg0.conf <<'EOF'\n${text}\nEOF`);
  assert.match(all(root.run('systemctl enable --now wg-quick@wg0 2>&1')), /Created symlink \/etc\/systemd\/system\/multi-user\.target\.wants\/wg-quick@wg0\.service → \/usr\/lib\/systemd\/system\/wg-quick@\.service\./);
  assert.match(all(root.run('systemctl status wg-quick@wg0')), /Loaded: loaded \(\/usr\/lib\/systemd\/system\/wg-quick@\.service; enabled; preset: enabled\)\n {5}Active: active \(exited\)/);
  assert.match(all(root.run('nft list tables')), /table inet wg_wg0/, 'PostUp ran with bash (%i expanded)');
  assert.match(ping(a.pc, '192.168.2.10', 4), /[34] received/);
  const copy = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const a2 = copy.get(a.lr.id)?.device as LinuxRouter;
  const pc2 = copy.get(a.pc.id)?.device as Pc;
  assert.ok(a2.wgm.get('wg0')?.up, 'wg0 is up after loading');
  assert.match(ping(pc2, '192.168.2.10', 4), /[34] received/);
  assert.equal(all(createShell(a2, 'linux', 'root').run('systemctl is-enabled wg-quick@wg0')), 'enabled');
  root.run('systemctl stop wg-quick@wg0');
  assert.doesNotMatch(all(root.run('nft list tables')), /wg_wg0/, 'PostDown ran');
  assert.match(all(createShell(a.lr, 'linux').run('systemctl start wg-quick@wg0 2>&1')), /Interactive authentication required/);
});
