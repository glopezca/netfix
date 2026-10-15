/** Ready-made labs that show each DHCP feature working. */
import { decorateLab } from './lab-areas.ts';
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import { Topology } from './topology.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';
import { parseIp } from '../core/ip.ts';
import { applyConfig } from '../ios/session.ts';
import { formatHexId, formatMacCisco, clientIdFromMac } from '../core/mac.ts';
import { internetExample } from './example-internet.ts';
import { ipsecLab, wireguardLab } from './labs-vpn.ts';
import { dmzLab, dnsForwardLab } from './labs-linux.ts';
import { hardeningLab, sshLab } from './labs-security.ts';

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

const LABS: readonly Example[] = [
  {
    id: 'basico',
    title: LABS_ES['lab.basico.title'],
    summary: LABS_ES['lab.basico.summary'],
    build: () => {
      const t = new Topology();
      const { r, p } = lanBase(t, 3);
      conf(r, GATEWAY_LAN);
      return startDhcp(t, p);
    },
  },
  {
    id: 'reservas',
    title: LABS_ES['lab.reservas.title'],
    summary: LABS_ES['lab.reservas.summary'],
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
    title: LABS_ES['lab.relay.title'],
    summary: LABS_ES['lab.relay.summary'],
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
    title: LABS_ES['lab.vlans.title'],
    summary: LABS_ES['lab.vlans.summary'],
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
    title: LABS_ES['lab.snooping.title'],
    summary: LABS_ES['lab.snooping.summary'],
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
    title: LABS_ES['lab.cliente.title'],
    summary: LABS_ES['lab.cliente.summary'],
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
    id: 'servidores',
    title: LABS_ES['lab.servidores.title'],
    summary: LABS_ES['lab.servidores.summary'],
    build: () => {
      const t = new Topology();
      const ip = (x: string): number => parseIp(x) ?? 0;
      const r = t.add('router', 460, 120).device as Router;
      const s = t.add('switch', 460, 300).device as Switch;
      const srv = t.add('server', 760, 300, { label: 'SRV0' }).device as Server;
      link(t, r.id, 'GigabitEthernet0/0', s.id, 'GigabitEthernet0/1');
      link(t, srv.id, 'FastEthernet0', s.id, 'FastEthernet0/24');
      const p = [0, 1].map((i) => {
        const pc = t.add('pc', 300 + i * 240, 500).device as Pc;
        link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
        return pc;
      });
      const [pc0, pc1] = p as [Pc, Pc];
      pc1.os = 'linux';
      conf(r, `
hostname GW
interface GigabitEthernet0/0
 ip address 192.168.10.1 255.255.255.0
 no shutdown`);
      srv.name = 'srv';
      srv.setStatic({ ip: ip('192.168.10.2'), prefix: 24, gateway: ip('192.168.10.1'), dns: ip('192.168.10.2') });
      srv.setServices({
        ...srv.services,
        dhcp: { enabled: true, pools: [{ name: 'serverPool', start: ip('192.168.10.100'), prefix: 24, maxUsers: 50, gateway: ip('192.168.10.1'), dns: ip('192.168.10.2'), domain: 'aula.lab', leaseMinutes: 1440, reservations: [{ ip: ip('192.168.10.50'), mac: pc1.mac, name: 'PC1 (Linux)' }] }] },
        dns: { enabled: true, origin: 'aula.lab', records: [
          { name: '@', type: 'NS', value: 'srv', ttl: 86400 },
          { name: 'srv', type: 'A', value: '192.168.10.2', ttl: 86400 },
          { name: 'gw', type: 'A', value: '192.168.10.1', ttl: 86400 },
          { name: 'www', type: 'CNAME', value: 'srv', ttl: 86400 },
          { name: 'webmail', type: 'CNAME', value: 'srv', ttl: 86400 },
          { name: '@', type: 'MX', value: 'srv.aula.lab.', priority: 10, ttl: 86400 },
        ] },
        mail: { smtp: true, pop3: true, imap: true, domain: 'aula.lab', users: [{ name: 'ana', password: 'ana1' }, { name: 'luis', password: 'luis1' }] },
        ssh: { enabled: true, users: [{ name: 'admin', password: 'netfix' }] },
        webapps: {
          roundcube: { enabled: true, mode: 'alias', alias: '/roundcube', port: 8080 },
          admin: { enabled: true, mode: 'port', alias: '/admin', port: 10000, user: 'admin', password: 'netfix' },
        },
      });
      pc0.mailAccount = { name: 'Ana', address: 'ana@aula.lab', incoming: 'srv.aula.lab', outgoing: 'srv.aula.lab', protocol: 'IMAP', user: 'ana', password: 'ana1' };
      pc0.browserUrl = 'http://www.aula.lab';
      pc1.mailAccount = { name: 'Luis', address: 'luis@aula.lab', incoming: 'srv.aula.lab', outgoing: 'srv.aula.lab', protocol: 'POP3', user: 'luis', password: 'luis1' };
      return startDhcp(t, p);
    },
  },
  internetExample,
  ipsecLab,
  wireguardLab,
  dmzLab,
  dnsForwardLab,
  sshLab,
  hardeningLab,
  {
    id: 'blanco',
    title: LABS_ES['lab.blanco.title'],
    summary: LABS_ES['lab.blanco.summary'],
    build: () => new Topology(),
  },
];

/** The labs, with areas drawn around their networks where they help to read the diagram. */
export const EXAMPLES: readonly Example[] = LABS.map((ex) => ({ ...ex, build: () => decorateLab(ex.id, ex.build()) }));
