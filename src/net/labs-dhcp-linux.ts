/**
 * The DHCP chapter on the GNU/Linux router (S26 phase 4): Kea on the router (basico-linux, reservas-linux), a relay
 * with isc-dhcp-relay towards an Ubuntu Server (relay) and the router as a DHCP client of an ISP (cliente).
 * The Cisco versions of basico and reservas stay in examples.ts.
 */
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Switch } from '../devices/switch.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { LinuxRouter } from '../devices/linux-router.ts';
import type { PtDhcpPool } from '../services/config.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { clientIdFromMac, formatHexId } from '../core/mac.ts';
import { fileCmd, rootScript } from './labs-linux.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

/** Forwarding on for good (as a router's /etc/sysctl.d file), then the lab's own commands. */
function routerScript(r: LinuxRouter, script: string): void {
  rootScript(r, `${fileCmd('/etc/sysctl.d/99-router.conf', 'net.ipv4.ip_forward = 1')}
sysctl -q --system
${script.trim()}`);
}

/** The pool Kea serves on the LAN of GW, as the Cisco GW's pool LAN (.1–.20 left out). */
export const LAN_POOL: PtDhcpPool = {
  name: 'LAN', start: ip('192.168.10.21'), prefix: 24, maxUsers: 200,
  gateway: ip('192.168.10.1'), dns: ip('8.8.8.8'), domain: 'aula.lab', leaseMinutes: 480, reservations: [],
};

/** Router GW (GNU/Linux, eth0 to the LAN), Switch0 and `pcs` PCs, one Windows and one GNU/Linux per pair. */
function linuxLan(t: Topology, pcs: number): { gw: LinuxRouter; p: Pc[] } {
  const gw = t.add('linuxrouter', 460, 140, { label: 'GW' }).device as LinuxRouter;
  const s = t.add('switch', 460, 320).device as Switch;
  link(t, gw.id, 'GigabitEthernet0/0', s.id, 'GigabitEthernet0/1');
  const p = Array.from({ length: pcs }, (_, i) => {
    const pc = t.add('pc', 220 + i * 240, 520).device as Pc;
    if (i % 2) pc.os = 'linux';
    link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
    return pc;
  });
  routerScript(gw, 'ip addr add 192.168.10.1/24 dev eth0');
  return { gw, p };
}

/** Kea on GW with the pool LAN (and its reservations), and the PCs asking for an address. */
function keaLan(t: Topology, gw: LinuxRouter, p: readonly Pc[], pool: PtDhcpPool): Topology {
  gw.setServices({ ...gw.services, dhcp: { enabled: true, pools: [pool] } });
  t.settle();
  for (const pc of p) pc.useDhcp();
  t.settle();
  return t;
}

export const basicoLinuxLab: Example = {
  id: 'basico-linux',
  title: LABS_ES['lab.basico-linux.title'],
  summary: LABS_ES['lab.basico-linux.summary'],
  build: () => {
    const t = new Topology();
    const { gw, p } = linuxLan(t, 3);
    return keaLan(t, gw, p, LAN_POOL);
  },
};

export const reservasLinuxLab: Example = {
  id: 'reservas-linux',
  title: LABS_ES['lab.reservas-linux.title'],
  summary: LABS_ES['lab.reservas-linux.summary'],
  build: () => {
    const t = new Topology();
    const { gw, p } = linuxLan(t, 3);
    const [a, b, c] = p as [Pc, Pc, Pc];
    return keaLan(t, gw, p, { ...LAN_POOL, reservations: [
      { ip: ip('192.168.10.100'), clientId: clientIdFromMac(a.mac), name: 'pc0' },
      { ip: ip('192.168.10.101'), mac: b.mac, name: 'pc1' },
      { ip: ip('192.168.10.150'), clientId: clientIdFromMac(c.mac), name: 'pc2' },
    ] });
  },
};

export const RELAY_FILE = '/etc/default/isc-dhcp-relay';

export const relayLinuxLab: Example = {
  id: 'relay',
  title: LABS_ES['lab.relay.title'],
  summary: LABS_ES['lab.relay.summary'],
  build: () => {
    const t = new Topology();
    const srv = t.add('server', 240, 140, { label: 'DHCP-SRV' }).device as Server;
    const edge = t.add('linuxrouter', 600, 140, { label: 'EDGE' }).device as LinuxRouter;
    const s = t.add('switch', 600, 320).device as Switch;
    link(t, srv.id, 'FastEthernet0', edge.id, 'GigabitEthernet0/0');
    link(t, edge.id, 'GigabitEthernet0/1', s.id, 'GigabitEthernet0/1');
    const p = [0, 1].map((i) => {
      const pc = t.add('pc', 480 + i * 240, 500).device as Pc;
      if (i === 1) pc.os = 'linux';
      link(t, pc.id, 'FastEthernet0', s.id, `FastEthernet0/${i + 1}`);
      return pc;
    });
    srv.setStatic({ ip: ip('10.0.0.1'), prefix: 30, gateway: ip('10.0.0.2'), dns: ip('10.0.0.1') });
    srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{
      name: 'SEDE-B', start: ip('10.20.0.10'), prefix: 24, maxUsers: 100, gateway: ip('10.20.0.1'), dns: ip('10.0.0.1'), leaseMinutes: 1440, reservations: [],
    }] } });
    routerScript(edge, `ip addr add 10.0.0.2/30 dev eth0
ip addr add 10.20.0.1/24 dev eth1
sed -i 's/^SERVERS=.*/SERVERS="10.0.0.1"/; s/^INTERFACES=.*/INTERFACES="eth1 eth0"/' ${RELAY_FILE}
systemctl enable --now isc-dhcp-relay`);
    t.settle();
    for (const pc of p) pc.useDhcp();
    t.settle();
    return t;
  },
};

/** CPE's netplan with eth0 by DHCP (`dhcp`) or not, its other two ports unused; then netplan apply. */
export function cpeNetplan(dhcp: boolean): string {
  return `${fileCmd('/etc/netplan/50-cloud-init.yaml', `network:
  version: 2
  ethernets:
    eth0:
      dhcp4: ${dhcp}
    eth1:
      dhcp4: false
    eth2:
      dhcp4: false`)}
netplan apply`;
}

export const clienteLinuxLab: Example = {
  id: 'cliente',
  title: LABS_ES['lab.cliente.title'],
  summary: LABS_ES['lab.cliente.summary'],
  build: () => {
    const t = new Topology();
    const isp = t.add('router', 300, 200, { label: 'ISP' }).device as Router;
    const cpe = t.add('linuxrouter', 640, 200, { label: 'CPE' }).device as LinuxRouter;
    link(t, isp.id, 'GigabitEthernet0/0', cpe.id, 'GigabitEthernet0/0');
    applyConfig(isp, `hostname ISP
ip dhcp excluded-address 100.64.0.1
ip dhcp pool CLIENTES
 network 100.64.0.0 255.255.255.0
 default-router 100.64.0.1
ip dhcp pool CPE-FIJO
 host 100.64.0.77 255.255.255.0
 client-identifier ${formatHexId(clientIdFromMac(cpe.mac))}
interface GigabitEthernet0/0
 ip address 100.64.0.1 255.255.255.0
 no shutdown`.split('\n'));
    rootScript(cpe, cpeNetplan(true));
    t.settle();
    return t;
  },
};
