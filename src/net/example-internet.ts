/** Lab "Internet: dos sedes": two ISP clouds, NAT on a Cisco router and a site published with a domain. */
import { newZone } from '../services/dns-zones.ts';
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Switch } from '../devices/switch.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { Cloud } from '../devices/cloud.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

const SEDE1 = `
hostname SEDE1
no ip domain-lookup
ip dhcp excluded-address 192.168.10.1 192.168.10.9
ip dhcp pool LAN
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
 dns-server 8.8.8.8 8.8.4.4
interface GigabitEthernet0/0
 description LAN de la sede 1
 ip address 192.168.10.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 description Fibra ISP-Norte
 ip address dhcp
 ip nat outside
 no shutdown
access-list 1 permit 192.168.10.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload`;

function sede1(t: Topology, isp: Cloud): Pc[] {
  const r = t.add('router', 240, 260, { label: 'SEDE1' }).device as Router;
  const s = t.add('switch', 240, 420).device as Switch;
  link(t, r.id, 'GigabitEthernet0/1', isp.id, 'Fibra0');
  link(t, r.id, 'GigabitEthernet0/0', s.id, 'GigabitEthernet0/1');
  applyConfig(r, SEDE1.trim().split('\n'));
  return [0, 1].map((i) => {
    const pc = t.add('pc', 120 + i * 240, 580).device as Pc;
    link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
    if (i === 1) pc.os = 'linux';
    pc.browserUrl = 'http://www.sede2.es';
    return pc;
  });
}

function sede2(t: Topology, isp: Cloud): Pc {
  const s = t.add('switch', 780, 420).device as Switch;
  const srv = t.add('server', 900, 580, { label: 'SRV-SEDE2' }).device as Server;
  const pc = t.add('pc', 660, 580).device as Pc;
  link(t, s.id, 'GigabitEthernet0/1', isp.id, 'DSL0');
  link(t, srv.id, 'FastEthernet0', s.id, 'FastEthernet0/24');
  link(t, pc.id, 'FastEthernet0', s.id, 'FastEthernet0/1');
  srv.name = 'srv';
  srv.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1'), dns: ip('8.8.8.8') });
  srv.setServices({
    ...srv.services,
    dhcp: { ...srv.services.dhcp, enabled: false },
    dns: { enabled: true, zones: [{ ...newZone('sede2.es', 'forward', ['srv.sede2.es']), records: [
      { name: 'srv', type: 'A', value: '81.33.3.2', ttl: 3600 },
      { name: '@', type: 'A', value: '81.33.3.2', ttl: 3600 },
      { name: 'www', type: 'CNAME', value: 'srv', ttl: 3600 },
    ] }] },
  });
  const tcp = (port: number) => ({ proto: 'tcp' as const, port, ip: ip('192.168.1.10'), toPort: port });
  isp.setSettings({
    ...isp.settings,
    isp: 'ISP-Sur',
    ports: { ...isp.settings.ports, DSL0: { ...isp.settings.ports.DSL0, forwards: [tcp(80), tcp(22), { proto: 'udp', port: 53, ip: ip('192.168.1.10'), toPort: 53 }] } },
    domains: [{ name: 'sede2.es', kind: 'ns', ip: ip('81.33.3.2') }],
  });
  return pc;
}

export const internetExample: Example = {
  id: 'internet',
  title: LABS_ES['lab.internet.title'],
  summary: LABS_ES['lab.internet.summary'],
  build: () => {
    const t = new Topology();
    const norte = t.add('cloud', 240, 90, { label: 'ISP-Norte' }).device as Cloud;
    const sur = t.add('cloud', 780, 90, { label: 'ISP-Sur' }).device as Cloud;
    norte.setSettings({ ...norte.settings, isp: 'ISP-Norte', ports: { ...norte.settings.ports, Fibra0: { ...norte.settings.ports.Fibra0, mode: 'public' } } });
    const pcs = [...sede1(t, norte), sede2(t, sur)];
    for (const p of pcs) p.useDhcp();
    t.settle();
    return t;
  },
};
