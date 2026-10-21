/**
 * Labs of the Linux router and of the company DNS: NAT + DMZ with nftables (what is published, what is
 * kept apart) and a bind9 server that answers its zone and forwards the rest to 8.8.8.8 (localnets only).
 */
import { newZone } from '../services/dns-zones.ts';
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { LinuxRouter } from '../devices/linux-router.ts';
import type { Switch } from '../devices/switch.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { createShell } from '../shells/factory.ts';
import { branchLan, cloud } from './labs-vpn.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

/** Runs an admin script as root (history expansion off: config files may contain «!»). */
export function rootScript(host: Server, script: string): void {
  const root = createShell(host, 'linux', 'root');
  root.run('set +H');
  root.run(script.trim());
}

export function fileCmd(path: string, text: string): string {
  return `cat > ${path} <<'NETFIX_EOF'\n${text.trim()}\nNETFIX_EOF`;
}

// ------------------------------------------------------------ Linux router: NAT and DMZ

const DMZ_RULES = `
flush ruleset

table inet filter {
  chain input {
    type filter hook input priority filter; policy drop;
    ct state established,related accept
    iifname "lo" accept
    iifname "eth1" tcp dport { 22, 10000 } accept comment "administracion solo desde la LAN"
    icmp type echo-request accept
  }
  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    iifname "eth1" accept comment "LAN a todas partes"
    iifname "eth2" oifname "eth0" accept comment "DMZ solo a Internet"
    iifname "eth0" oifname "eth2" ip daddr 172.16.0.80 tcp dport 80 accept comment "web publicada"
    log prefix "FW-DROP " drop
  }
}

table ip nat {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "eth0" tcp dport 80 dnat to 172.16.0.80
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "eth0" masquerade
  }
}`;

export const dmzLab: Example = {
  id: 'linux-dmz',
  title: LABS_ES['lab.linux-dmz.title'],
  summary: LABS_ES['lab.linux-dmz.summary'],
  build: () => {
    const t = new Topology();
    const norte = cloud(t, 'ISP-Norte', 240, 'Fibra0', 'public');
    const sur = cloud(t, 'ISP-Sur', 780, 'DSL0', 'router');
    const fw = t.add('linuxrouter', 240, 260, { label: 'FW' }).device as LinuxRouter;
    link(t, fw.id, 'GigabitEthernet0/0', norte.id, 'Fibra0');
    branchLan(t, 160, { id: fw.id, port: 'GigabitEthernet0/1' }, '192.168.1', 2, '192.168.1.1');
    const web = t.add('server', 420, 420, { label: 'WEB-DMZ' }).device as Server;
    link(t, fw.id, 'GigabitEthernet0/2', web.id, 'FastEthernet0');
    web.setStatic({ ip: ip('172.16.0.80'), prefix: 24, gateway: ip('172.16.0.1'), dns: ip('8.8.8.8') });
    const ext = t.add('pc', 780, 420, { label: 'CLIENTE-EXT' }).device as Pc;
    link(t, ext.id, 'FastEthernet0', sur.id, 'DSL0');
    ext.os = 'linux';
    fw.useDhcp();
    ext.useDhcp();
    t.settle();
    rootScript(fw, `ip addr add 192.168.1.1/24 dev eth1
ip addr add 172.16.0.1/24 dev eth2
${fileCmd('/etc/sysctl.d/99-router.conf', 'net.ipv4.ip_forward = 1')}
${fileCmd('/etc/nftables.conf', DMZ_RULES)}
sysctl -q --system
systemctl enable --now nftables`);
    t.settle();
    return t;
  },
};

// ------------------------------------------------------------ company DNS with forwarders

const GW_DNS = `
hostname GW
no ip domain-lookup
interface GigabitEthernet0/0
 description LAN de la empresa (servidor DNS)
 ip address 192.168.50.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/2
 description Red de invitados
 ip address 192.168.60.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 ip address dhcp
 ip nat outside
 no shutdown
access-list 1 permit 192.168.50.0 0.0.0.255
access-list 1 permit 192.168.60.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload`;

function dnsServer(srv: Server, pcMac: string): void {
  srv.name = 'ns1';
  srv.setStatic({ ip: ip('192.168.50.2'), prefix: 24, gateway: ip('192.168.50.1'), dns: ip('127.0.0.1') });
  srv.setServices({
    ...srv.services,
    dhcp: { enabled: true, pools: [{ name: 'serverPool', start: ip('192.168.50.100'), prefix: 24, maxUsers: 50, gateway: ip('192.168.50.1'), dns: ip('192.168.50.2'), domain: 'empresa.lan', leaseMinutes: 1440, reservations: [{ ip: ip('192.168.50.50'), mac: pcMac, name: 'PC1' }] }] },
    dns: {
      enabled: true, recursion: true, forwarders: [ip('8.8.8.8'), ip('8.8.4.4')], forwardOnly: true, allowRecursion: 'localnets',
      zones: [{ ...newZone('empresa.lan', 'forward', ['ns1.empresa.lan']), records: [
        { name: 'ns1', type: 'A', value: '192.168.50.2', ttl: 86400 },
        { name: 'intranet', type: 'A', value: '192.168.50.2', ttl: 86400 },
        { name: 'www', type: 'CNAME', value: 'intranet', ttl: 86400 },
      ] }],
    },
  });
}

export const dnsForwardLab: Example = {
  id: 'dns-reenvio',
  title: LABS_ES['lab.dns-reenvio.title'],
  summary: LABS_ES['lab.dns-reenvio.summary'],
  build: () => {
    const t = new Topology();
    const norte = cloud(t, 'ISP-Norte', 460, 'Fibra0', 'public');
    const gw = t.add('router', 460, 220, { label: 'GW' }).device as Router;
    link(t, gw.id, 'GigabitEthernet0/1', norte.id, 'Fibra0');
    applyConfig(gw, GW_DNS.trim().split('\n'));
    const pcs = branchLan(t, 300, { id: gw.id, port: 'GigabitEthernet0/0' }, '192.168.50', 2);
    const sw = t.byLabel('Switch0') as Switch;
    const srv = t.add('server', 620, 420, { label: 'NS1' }).device as Server;
    link(t, srv.id, 'FastEthernet0', sw.id, 'FastEthernet0/24');
    dnsServer(srv, (pcs[1] as Pc).mac);
    const guest = t.add('pc', 760, 420, { label: 'INVITADO' }).device as Pc;
    guest.os = 'linux';
    link(t, guest.id, 'FastEthernet0', gw.id, 'GigabitEthernet0/2');
    guest.setStatic({ ip: ip('192.168.60.10'), prefix: 24, gateway: ip('192.168.60.1'), dns: ip('192.168.50.2') });
    t.settle();
    for (const p of pcs) p.useDhcp();
    t.settle();
    return t;
  },
};
