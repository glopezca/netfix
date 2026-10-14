/**
 * VPN labs: two Cisco 2911 branches joined by IPsec over two ISPs, and a Linux hub with a branch behind
 * the operator's NAT joined by WireGuard (keepalive and endpoint learning).
 */
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Switch } from '../devices/switch.ts';
import type { Pc } from '../devices/pc.ts';
import type { Cloud } from '../devices/cloud.ts';
import type { LinuxRouter } from '../devices/linux-router.ts';
import type { LineMode } from '../devices/cloud-config.ts';
import { applyConfig } from '../ios/session.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { createShell } from '../shells/factory.ts';
import { genKey, pubKey } from '../core/x25519.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

export function cloud(t: Topology, label: string, x: number, port: 'Fibra0' | 'DSL0', mode: LineMode): Cloud {
  const c = t.add('cloud', x, 90, { label }).device as Cloud;
  c.setSettings({ ...c.settings, isp: label, ports: { ...c.settings.ports, [port]: { ...c.settings.ports[port], mode } } });
  return c;
}

/** Switch and PCs of a branch LAN (`net` = "192.168.10"), static when `gateway` is given, else DHCP. */
export function branchLan(t: Topology, x: number, up: { id: string; port: string }, net: string, pcs: number, gateway?: string): Pc[] {
  const s = t.add('switch', x, 420).device as Switch;
  link(t, up.id, up.port, s.id, 'GigabitEthernet0/1');
  return Array.from({ length: pcs }, (_, i) => {
    const pc = t.add('pc', x - 110 + i * 220, 580).device as Pc;
    link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
    if (i === 1) pc.os = 'linux';
    if (gateway) pc.setStatic({ ip: ip(`${net}.${10 + i}`), prefix: 24, gateway: ip(gateway), dns: ip('8.8.8.8') });
    return pc;
  });
}

// ------------------------------------------------------------ IPsec between two 2911

function siteBase(name: string, lan: string, remote: string): string {
  return `
hostname ${name}
no ip domain-lookup
ip dhcp excluded-address ${lan}.1 ${lan}.9
ip dhcp pool LAN
 network ${lan}.0 255.255.255.0
 default-router ${lan}.1
 dns-server 8.8.8.8
interface GigabitEthernet0/0
 ip address ${lan}.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 description Linea publica del ISP
 ip address dhcp
 ip nat outside
 no shutdown
ip access-list extended NAT
 remark el trafico entre sedes va por el tunel, sin NAT
 deny ip ${lan}.0 0.0.0.255 ${remote}.0 0.0.0.255
 permit ip ${lan}.0 0.0.0.255 any
ip nat inside source list NAT interface GigabitEthernet0/1 overload`;
}

function cryptoConf(lan: string, remote: string, peer: number): string {
  return `
crypto isakmp policy 10
 encryption aes 256
 hash sha
 authentication pre-share
 group 5
crypto isakmp key Netfix-VPN-2026 address ${formatIp(peer)}
crypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac
ip access-list extended VPN
 permit ip ${lan}.0 0.0.0.255 ${remote}.0 0.0.0.255
crypto map VPN 10 ipsec-isakmp
 set peer ${formatIp(peer)}
 set transform-set TS-AES
 match address VPN
interface GigabitEthernet0/1
 crypto map VPN`;
}

export const ipsecLab: Example = {
  id: 'vpn-ipsec',
  title: LABS_ES['lab.vpn-ipsec.title'],
  summary: LABS_ES['lab.vpn-ipsec.summary'],
  build: () => {
    const t = new Topology();
    const norte = cloud(t, 'ISP-Norte', 240, 'Fibra0', 'public');
    const sur = cloud(t, 'ISP-Sur', 780, 'Fibra0', 'public');
    const a = t.add('router', 240, 260, { label: 'SEDE-A' }).device as Router;
    const b = t.add('router', 780, 260, { label: 'SEDE-B' }).device as Router;
    link(t, a.id, 'GigabitEthernet0/1', norte.id, 'Fibra0');
    link(t, b.id, 'GigabitEthernet0/1', sur.id, 'Fibra0');
    applyConfig(a, siteBase('SEDE-A', '192.168.10', '192.168.20').trim().split('\n'));
    applyConfig(b, siteBase('SEDE-B', '192.168.20', '192.168.10').trim().split('\n'));
    const pcs = [...branchLan(t, 240, { id: a.id, port: 'GigabitEthernet0/0' }, '192.168.10', 2), ...branchLan(t, 780, { id: b.id, port: 'GigabitEthernet0/0' }, '192.168.20', 2)];
    t.settle();
    const wanA = a.dhcpLearned('GigabitEthernet0/1')?.ip ?? 0;
    const wanB = b.dhcpLearned('GigabitEthernet0/1')?.ip ?? 0;
    applyConfig(a, cryptoConf('192.168.10', '192.168.20', wanB).trim().split('\n'));
    applyConfig(b, cryptoConf('192.168.20', '192.168.10', wanA).trim().split('\n'));
    for (const p of pcs) p.useDhcp();
    t.settle();
    return t;
  },
};

// ------------------------------------------------------------ WireGuard: Linux hub and branch behind NAT

function routerFirewall(wan: string, lan: string): string {
  return `#!/usr/sbin/nft -f
flush ruleset

table inet filter {
  chain input {
    type filter hook input priority filter; policy drop;
    ct state established,related accept
    iifname "lo" accept
    icmp type echo-request accept
    udp dport 51820 accept comment "WireGuard"
    iifname { "${lan}", "wg0" } tcp dport 22 accept comment "SSH solo desde dentro"
  }
  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    iifname "${lan}" accept
    iifname "wg0" oifname "${lan}" accept
  }
}

table ip nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "${wan}" masquerade
  }
}
`;
}

function wgConf(priv: string, addr: string, peer: string, allowed: string, extra: string): string {
  return `[Interface]\nAddress = ${addr}/24\nListenPort = 51820\nPrivateKey = ${priv}\n\n[Peer]\nPublicKey = ${peer}\nAllowedIPs = ${allowed}\n${extra}`;
}

/** Writes the router's files (sysctl, nftables, wg0.conf) and starts the units, as an admin would. */
function setupLinux(lr: LinuxRouter, lanCidr: string, wg: string): void {
  const files = [
    ["/etc/sysctl.d/99-router.conf", 'net.ipv4.ip_forward = 1\n'],
    ['/etc/nftables.conf', routerFirewall('eth0', 'eth1')],
    ['/etc/wireguard/wg0.conf', wg],
  ];
  const script = files.map(([path, text]) => `cat > ${path} <<'NETFIX_EOF'\n${text}\nNETFIX_EOF`).join('\n');
  // set +H: the files contain «#!/usr/sbin/nft -f» and an interactive bash would expand «!».
  const root = createShell(lr, 'linux', 'root');
  root.run('set +H');
  // umask 077 first: the private key in wg0.conf is never readable by others, not even for a moment.
  root.run(`umask 077\nip addr add ${lanCidr} dev eth1\n${script}\nchmod 600 /etc/wireguard/wg0.conf\nsysctl -q --system\nsystemctl enable --now nftables\nsystemctl enable --now wg-quick@wg0`);
}

export const wireguardLab: Example = {
  id: 'vpn-wireguard',
  title: LABS_ES['lab.vpn-wireguard.title'],
  summary: LABS_ES['lab.vpn-wireguard.summary'],
  build: () => {
    const t = new Topology();
    const norte = cloud(t, 'ISP-Norte', 240, 'Fibra0', 'public');
    const sur = cloud(t, 'ISP-Sur', 780, 'DSL0', 'router');
    const hub = t.add('linuxrouter', 240, 260, { label: 'CENTRAL' }).device as LinuxRouter;
    const branch = t.add('linuxrouter', 780, 260, { label: 'SUCURSAL' }).device as LinuxRouter;
    link(t, hub.id, 'GigabitEthernet0/0', norte.id, 'Fibra0');
    link(t, branch.id, 'GigabitEthernet0/0', sur.id, 'DSL0');
    branchLan(t, 240, { id: hub.id, port: 'GigabitEthernet0/1' }, '10.1.0', 2, '10.1.0.1');
    branchLan(t, 780, { id: branch.id, port: 'GigabitEthernet0/1' }, '10.2.0', 2, '10.2.0.1');
    hub.useDhcp();
    branch.useDhcp();
    t.settle();
    const [hubKey, branchKey] = [genKey(), genKey()];
    const hubIp = formatIp(hub.config.ip ?? 0);
    hub.setServices({ ...hub.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
    setupLinux(hub, '10.1.0.1/24', wgConf(hubKey, '10.99.0.1', pubKey(branchKey) ?? '', '10.99.0.2/32, 10.2.0.0/24', ''));
    setupLinux(branch, '10.2.0.1/24', wgConf(branchKey, '10.99.0.2', pubKey(hubKey) ?? '', '10.99.0.0/24, 10.1.0.0/24', `Endpoint = ${hubIp}:51820\nPersistentKeepalive = 25\n`));
    t.settle();
    return t;
  },
};
