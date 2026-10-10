/** Ready-made labs that show each DHCP feature working. */
import { Topology } from './topology.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { Pc } from '../devices/pc.ts';
import { applyConfig } from '../ios/session.ts';
import { formatHexId, formatMacCisco, clientIdFromMac } from '../core/mac.ts';

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  build(): Topology;
}

function conf(dev: Router | Switch, text: string): void {
  applyConfig(dev, text.trim().split('\n'));
}

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

function lanBase(t: Topology, pcs: number): { r: Router; s: Switch; p: Pc[] } {
  const r = t.add('router', 460, 140).device as Router;
  const s = t.add('switch', 460, 320).device as Switch;
  link(t, r.id, 'GigabitEthernet0/0', s.id, 'GigabitEthernet0/1');
  const p = Array.from({ length: pcs }, (_, i) => {
    const pc = t.add('pc', 220 + i * 240, 520).device as Pc;
    link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
    return pc;
  });
  return { r, s, p };
}

const GATEWAY_LAN = `
hostname GW
no ip domain-lookup
ip dhcp excluded-address 192.168.10.1 192.168.10.20
ip dhcp pool LAN
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
 dns-server 8.8.8.8
 domain-name aula.lab
 lease 0 8
interface GigabitEthernet0/0
 description LAN de alumnos
 ip address 192.168.10.1 255.255.255.0
 no shutdown`;

function startDhcp(t: Topology, pcs: readonly Pc[]): Topology {
  pcs.forEach((pc) => pc.useDhcp());
  t.settle();
  return t;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'basico',
    title: 'DHCP básico',
    summary: 'Un pool con exclusiones, puerta de enlace, DNS y dominio. Los tres PCs obtienen IP por DORA.',
    build: () => {
      const t = new Topology();
      const { r, p } = lanBase(t, 3);
      conf(r, GATEWAY_LAN);
      return startDhcp(t, p);
    },
  },
  {
    id: 'reservas',
    title: 'Reservas: host, client-identifier y hardware-address',
    summary: 'PC0 por client-identifier (pool host), PC1 por hardware-address (pool host) y PC2 con address … client-id dentro del pool de red.',
    build: () => {
      const t = new Topology();
      const { r, p } = lanBase(t, 3);
      const [a, b, c] = p as [Pc, Pc, Pc];
      conf(r, `${GATEWAY_LAN}
ip dhcp pool LAN
 address 192.168.10.150 client-id ${formatHexId(clientIdFromMac(c.mac))}
ip dhcp pool PC0-FIJO
 host 192.168.10.100 255.255.255.0
 client-identifier ${formatHexId(clientIdFromMac(a.mac))}
 client-name pc0
ip dhcp pool PC1-FIJO
 host 192.168.10.101 255.255.255.0
 hardware-address ${formatMacCisco(b.mac)}`);
      return startDhcp(t, p);
    },
  },
  {
    id: 'relay',
    title: 'Relay con ip helper-address',
    summary: 'El servidor DHCP está en otra red. EDGE reenvía las peticiones con giaddr 10.20.0.1.',
    build: () => {
      const t = new Topology();
      const srv = t.add('router', 240, 140).device as Router;
      const edge = t.add('router', 600, 140).device as Router;
      const s = t.add('switch', 600, 320).device as Switch;
      link(t, srv.id, 'GigabitEthernet0/0', edge.id, 'GigabitEthernet0/0');
      link(t, edge.id, 'GigabitEthernet0/1', s.id, 'GigabitEthernet0/1');
      const p = [0, 1].map((i) => {
        const pc = t.add('pc', 480 + i * 240, 500).device as Pc;
        link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
        return pc;
      });
      conf(srv, `
hostname DHCP-SRV
ip dhcp excluded-address 10.20.0.1 10.20.0.9
ip dhcp pool SEDE-B
 network 10.20.0.0 255.255.255.0
 default-router 10.20.0.1
 dns-server 10.0.0.1
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.252
 no shutdown
ip route 10.20.0.0 255.255.255.0 10.0.0.2`);
      conf(edge, `
hostname EDGE
interface GigabitEthernet0/0
 ip address 10.0.0.2 255.255.255.252
 no shutdown
interface GigabitEthernet0/1
 ip address 10.20.0.1 255.255.255.0
 ip helper-address 10.0.0.1
 no shutdown`);
      return startDhcp(t, p);
    },
  },
  {
    id: 'vlans',
    title: 'Router-on-a-stick: un pool por VLAN',
    summary: 'Subinterfaces 802.1Q en el router, trunk en el switch y pools VENTAS y SOPORTE.',
    build: () => {
      const t = new Topology();
      const { r, s, p } = lanBase(t, 4);
      conf(s, `
hostname SW-ACCESO
vlan 10
 name VENTAS
vlan 20
 name SOPORTE
interface range FastEthernet0/1 - 2
 switchport mode access
 switchport access vlan 10
interface range FastEthernet0/3 - 4
 switchport mode access
 switchport access vlan 20
interface GigabitEthernet0/1
 switchport mode trunk`);
      conf(r, `
hostname GW
ip dhcp excluded-address 172.16.10.1
ip dhcp excluded-address 172.16.20.1
ip dhcp pool VENTAS
 network 172.16.10.0 255.255.255.0
 default-router 172.16.10.1
ip dhcp pool SOPORTE
 network 172.16.20.0 255.255.255.0
 default-router 172.16.20.1
interface GigabitEthernet0/0
 no shutdown
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 172.16.10.1 255.255.255.0
interface GigabitEthernet0/0.20
 encapsulation dot1Q 20
 ip address 172.16.20.1 255.255.255.0`);
      return startDhcp(t, p);
    },
  },
  {
    id: 'snooping',
    title: 'DHCP snooping frente a un servidor falso',
    summary: 'ROGUE ofrece una puerta de enlace falsa; el switch solo confía en Gig0/1. Fíjate en «ip dhcp relay information trusted» en GW.',
    build: () => {
      const t = new Topology();
      const { r, s, p } = lanBase(t, 2);
      const rogue = t.add('router', 820, 320).device as Router;
      link(t, rogue.id, 'GigabitEthernet0/0', s.id, 'FastEthernet0/24');
      conf(r, `${GATEWAY_LAN}
interface GigabitEthernet0/0
 ip dhcp relay information trusted`);
      conf(rogue, `
hostname ROGUE
ip dhcp pool TRAMPA
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.66
interface GigabitEthernet0/0
 ip address 192.168.10.66 255.255.255.0
 no shutdown`);
      conf(s, `
hostname SW
ip dhcp snooping
ip dhcp snooping vlan 1
interface GigabitEthernet0/1
 ip dhcp snooping trust`);
      return startDhcp(t, p);
    },
  },
  {
    id: 'cliente',
    title: 'Router como cliente DHCP',
    summary: 'CPE obtiene su IP WAN con «ip address dhcp»; ISP la fija con un pool host y su client-identifier cisco-….',
    build: () => {
      const t = new Topology();
      const isp = t.add('router', 300, 200).device as Router;
      const cpe = t.add('router', 640, 200).device as Router;
      link(t, isp.id, 'GigabitEthernet0/0', cpe.id, 'GigabitEthernet0/1');
      conf(isp, `
hostname ISP
ip dhcp excluded-address 100.64.0.1
ip dhcp pool CLIENTES
 network 100.64.0.0 255.255.255.0
 default-router 100.64.0.1
ip dhcp pool CPE-FIJO
 host 100.64.0.77 255.255.255.0
 client-identifier ${cpe.plane.clientIdText('GigabitEthernet0/1')}
interface GigabitEthernet0/0
 ip address 100.64.0.1 255.255.255.0
 no shutdown`);
      conf(cpe, `
hostname CPE
interface GigabitEthernet0/1
 ip address dhcp
 no shutdown`);
      t.settle();
      return t;
    },
  },
  {
    id: 'blanco',
    title: 'Área de trabajo en blanco',
    summary: 'Empieza desde cero: coloca dispositivos y conéctalos con el cable.',
    build: () => new Topology(),
  },
];
