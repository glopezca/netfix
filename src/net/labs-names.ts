/**
 * Labs of name resolution: a LAN whose only DNS is the public one (hosts, mDNS, LLMNR and NetBIOS, which Windows has built in and a
 * GNU/Linux host only with avahi or samba) and two LANs joined by a router (the DNS crosses it; the link protocols do not).
 */
import { newZone } from '../services/dns-zones.ts';
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { Switch } from '../devices/switch.ts';
import type { HostOs } from '../devices/host.ts';
import { setPackageInstalled } from './host-packages.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { cloud } from './labs-vpn.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

interface PcSpec {
  readonly label: string;
  readonly os: HostOs;
  readonly x: number;
  readonly addr: string;
}

function pcOn(t: Topology, sw: Switch, port: number, spec: PcSpec, y: number): Pc {
  const pc = t.add('pc', spec.x, y, { label: spec.label }).device as Pc;
  pc.os = spec.os;
  link(t, pc.id, 'FastEthernet0', sw.id, `FastEthernet0/${port}`);
  return pc;
}

// ------------------------------------------------------------ One LAN, no DNS server of its own

/** A home router: NAT to the ISP, the public DNS for everything (it knows no name of the LAN). */
const GW_HOME = `
hostname GW
no ip domain-lookup
interface GigabitEthernet0/0
 description LAN
 ip address 192.168.1.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 ip address dhcp
 ip nat outside
 no shutdown
access-list 1 permit 192.168.1.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload`;

const LAN_PCS: readonly PcSpec[] = [
  { label: 'WIN1', os: 'windows', x: 160, addr: '192.168.1.11' },
  { label: 'WIN2', os: 'windows', x: 380, addr: '192.168.1.12' },
  { label: 'LNX1', os: 'linux', x: 600, addr: '192.168.1.21' },
  { label: 'LNX2', os: 'linux', x: 820, addr: '192.168.1.22' },
];

export const namesLanLab: Example = {
  id: 'nombres-lan',
  title: LABS_ES['lab.nombres-lan.title'],
  summary: LABS_ES['lab.nombres-lan.summary'],
  build: () => {
    const t = new Topology();
    const isp = cloud(t, 'ISP-Norte', 490, 'Fibra0', 'public');
    const gw = t.add('router', 490, 240, { label: 'GW' }).device as Router;
    link(t, gw.id, 'GigabitEthernet0/1', isp.id, 'Fibra0');
    applyConfig(gw, GW_HOME.trim().split('\n'));
    const sw = t.add('switch', 490, 400, { label: 'Switch0' }).device as Switch;
    link(t, gw.id, 'GigabitEthernet0/0', sw.id, 'GigabitEthernet0/1');
    for (const [i, spec] of LAN_PCS.entries()) {
      const pc = pcOn(t, sw, i + 1, spec, 600);
      pc.setStatic({ ip: ip(spec.addr), prefix: 24, gateway: ip('192.168.1.1'), dns: ip('8.8.8.8') });
    }
    // LNX1 has avahi (it answers and asks .local names); LNX2 has nothing installed yet.
    const lnx1 = t.byLabel('LNX1') as Pc;
    for (const name of ['avahi-daemon', 'libnss-mdns']) setPackageInstalled(lnx1, name, true);
    t.settle();
    return t;
  },
};

// ------------------------------------------------------------ Two LANs and a DNS server

const GW_NAMES = `
hostname GW
no ip domain-lookup
interface GigabitEthernet0/0
 description LAN A
 ip address 192.168.10.1 255.255.255.0
 no shutdown
interface GigabitEthernet0/1
 description LAN B
 ip address 192.168.20.1 255.255.255.0
 no shutdown`;

const NETS_PCS: readonly (PcSpec & { readonly lan: 'a' | 'b' })[] = [
  { label: 'WIN-A', os: 'windows', x: 360, addr: '192.168.10.11', lan: 'a' },
  { label: 'WIN-B', os: 'windows', x: 640, addr: '192.168.20.11', lan: 'b' },
  { label: 'WIN-B2', os: 'windows', x: 860, addr: '192.168.20.12', lan: 'b' },
];

function namesServer(srv: Server): void {
  srv.setStatic({ ip: ip('192.168.10.2'), prefix: 24, gateway: ip('192.168.10.1'), dns: ip('127.0.0.1') });
  srv.dnsSearch = ['aula.lab'];
  srv.setServices({
    ...srv.services,
    dns: { enabled: true, zones: [{ ...newZone('aula.lab', 'forward', ['srv.aula.lab']), records: [
      { name: 'srv', type: 'A', value: '192.168.10.2', ttl: 86400 },
      { name: 'gw', type: 'A', value: '192.168.10.1', ttl: 86400 },
      { name: 'win-a', type: 'A', value: '192.168.10.11', ttl: 86400 },
      { name: 'win-b', type: 'A', value: '192.168.20.11', ttl: 86400 },
    ] }] },
  });
}

export const namesNetsLab: Example = {
  id: 'nombres-redes',
  title: LABS_ES['lab.nombres-redes.title'],
  summary: LABS_ES['lab.nombres-redes.summary'],
  build: () => {
    const t = new Topology();
    const gw = t.add('router', 500, 100, { label: 'GW' }).device as Router;
    applyConfig(gw, GW_NAMES.trim().split('\n'));
    const swA = t.add('switch', 260, 280, { label: 'SW-A' }).device as Switch;
    const swB = t.add('switch', 750, 280, { label: 'SW-B' }).device as Switch;
    link(t, gw.id, 'GigabitEthernet0/0', swA.id, 'GigabitEthernet0/1');
    link(t, gw.id, 'GigabitEthernet0/1', swB.id, 'GigabitEthernet0/1');
    const srv = t.add('server', 140, 480, { label: 'SRV' }).device as Server;
    link(t, srv.id, 'FastEthernet0', swA.id, 'FastEthernet0/24');
    namesServer(srv);
    for (const [i, spec] of NETS_PCS.entries()) {
      const pc = pcOn(t, spec.lan === 'a' ? swA : swB, i + 1, spec, 480);
      pc.setStatic({ ip: ip(spec.addr), prefix: 24, gateway: ip(spec.lan === 'a' ? '192.168.10.1' : '192.168.20.1'), dns: ip('192.168.10.2') });
      pc.dnsSearch = ['aula.lab'];
    }
    t.settle();
    return t;
  },
};
