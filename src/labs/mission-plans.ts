/**
 * What each guided lab asks for, as plain data: how many tasks it has, the rubric the marking checks and the help pages
 * worth reading. The texts live in the catalogue (mission.<id>.*); how the lab is broken or finished lives in
 * missions.ts. No imports of the simulator, so the documentation can build its lab pages from here.
 */
import type { Check } from '../classroom/checklist.ts';

/** Hints per task, from the most general to the most specific. */
export const HINT_LEVELS = 3;

export interface MissionItem {
  readonly id: string;
  /** The task (1-based) the item checks. */
  readonly task: number;
  readonly weight?: number;
  readonly check: Check;
}

export interface MissionPlan {
  readonly id: string;
  readonly tasks: number;
  readonly items: readonly MissionItem[];
  /** Help pages (ids) worth reading for this mission. */
  readonly docs: readonly string[];
}

const lease = (device: string, network: string, gateway: string, dns?: string): Check => ({ type: 'ip', device, mode: 'dhcp', network, gateway, ...(dns ? { dns } : {}) });

const basico: MissionPlan = {
  id: 'basico',
  tasks: 3,
  docs: ['ios-dhcp', 'pc-ip', 'windows-cmd'],
  items: [
    { id: 'gateway', task: 1, weight: 2, check: { type: 'config', device: 'GW', section: 'ip dhcp pool LAN', lines: [' default-router 192.168.10.1'] } },
    { id: 'dns', task: 2, weight: 2, check: { type: 'config', device: 'GW', section: 'ip dhcp pool LAN', lines: [' dns-server 8.8.8.8'] } },
    { id: 'pc0', task: 3, check: lease('PC0', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
    { id: 'pc1', task: 3, check: lease('PC1', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
    { id: 'pc2', task: 3, check: lease('PC2', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
  ],
};

const fixed = (device: string, ip: string): Check => ({ type: 'ip', device, mode: 'dhcp', ip });

const reservas: MissionPlan = {
  id: 'reservas',
  tasks: 3,
  docs: ['ios-reservas', 'ios-dhcp', 'pc-ip'],
  items: [
    { id: 'pc0', task: 1, check: fixed('PC0', '192.168.10.100') },
    { id: 'pc1', task: 2, check: fixed('PC1', '192.168.10.101') },
    { id: 'pc2', task: 3, check: fixed('PC2', '192.168.10.150') },
  ],
};

const KEA = '/etc/kea/kea-dhcp4.conf';
const LINUX_DHCP_DOCS = ['srv-dhcp', 'linux-router', 'pc-ip'];

/** basico on the GNU/Linux router: the same story, Kea's option-data instead of the IOS pool. */
const basicoLinux: MissionPlan = {
  id: 'basico-linux',
  tasks: 3,
  docs: LINUX_DHCP_DOCS,
  items: [
    { id: 'gateway', task: 1, weight: 2, check: { type: 'file', device: 'GW', path: KEA, contains: '"routers"' } },
    { id: 'dns', task: 2, weight: 2, check: { type: 'file', device: 'GW', path: KEA, contains: '"domain-name-servers"' } },
    { id: 'pc0', task: 3, check: lease('PC0', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
    { id: 'pc1', task: 3, check: lease('PC1', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
    { id: 'pc2', task: 3, check: lease('PC2', '192.168.10.0/24', '192.168.10.1', '8.8.8.8') },
  ],
};

const reservasLinux: MissionPlan = { ...reservas, id: 'reservas-linux', docs: LINUX_DHCP_DOCS };

/** isc-dhcp-relay on EDGE (GNU/Linux) and the way back from DHCP-SRV (Ubuntu Server). */
const relay: MissionPlan = {
  id: 'relay',
  tasks: 3,
  docs: ['srv-dhcp', 'red-broadcast', 'linux-router'],
  items: [
    { id: 'helper', task: 1, weight: 2, check: { type: 'file', device: 'EDGE', path: '/etc/default/isc-dhcp-relay', contains: 'SERVERS="10.0.0.1"' } },
    { id: 'route', task: 2, weight: 2, check: { type: 'ping', from: 'DHCP-SRV', to: '10.20.0.1', expect: 'success' } },
    { id: 'pc0', task: 3, check: lease('PC0', '10.20.0.0/24', '10.20.0.1') },
    { id: 'pc1', task: 3, check: lease('PC1', '10.20.0.0/24', '10.20.0.1') },
    { id: 'ping', task: 3, check: { type: 'ping', from: 'PC0', to: '10.0.0.1', expect: 'success' } },
  ],
};

/** CPE is a GNU/Linux router: netplan asks for the address, ISP (IOS) pins it by 01 + MAC. */
const cliente: MissionPlan = {
  id: 'cliente',
  tasks: 3,
  docs: ['linux-red', 'ios-reservas', 'ios-dhcp'],
  items: [
    { id: 'dhcp', task: 1, check: { type: 'ip', device: 'CPE', mode: 'dhcp' } },
    { id: 'fixed', task: 2, weight: 2, check: { type: 'ip', device: 'CPE', mode: 'dhcp', ip: '100.64.0.77' } },
    { id: 'router', task: 3, check: { type: 'config', device: 'ISP', section: 'ip dhcp pool CLIENTES', lines: [' default-router 100.64.0.1'] } },
    { id: 'route', task: 3, check: { type: 'ip', device: 'CPE', mode: 'dhcp', gateway: '100.64.0.1' } },
  ],
};

const namesNets: MissionPlan = {
  id: 'nombres-redes',
  tasks: 3,
  docs: ['red-nombres', 'srv-dns', 'windows-cmd'],
  items: [
    { id: 'local', task: 1, check: { type: 'ping', from: 'WIN-B', to: 'win-b2', expect: 'success' } },
    { id: 'record', task: 2, weight: 2, check: { type: 'dns', from: 'WIN-A', name: 'win-b2.aula.lab', ip: '192.168.20.12' } },
    { id: 'remote', task: 3, weight: 2, check: { type: 'ping', from: 'WIN-A', to: 'win-b2', expect: 'success' } },
  ],
};

const ping = (from: string, to: string): Check => ({ type: 'ping', from, to, expect: 'success' });

/** nombres-lan: LNX2 has nothing; three ways to a name without a DNS of the LAN. */
const namesLan: MissionPlan = {
  id: 'nombres-lan',
  tasks: 3,
  docs: ['red-nombres', 'linux-apt', 'srv-samba-clientes'],
  items: [
    { id: 'mdns', task: 1, check: ping('LNX2', 'lnx1.local') },
    { id: 'hosts', task: 2, check: ping('LNX2', 'win1') },
    { id: 'netbios', task: 3, weight: 2, check: ping('WIN1', 'lnx2') },
  ],
};

/** nombres-resolved: LLMNR through systemd-resolved, WINS for GNU/Linux and for Windows, past GW. */
const namesResolved: MissionPlan = {
  id: 'nombres-resolved',
  tasks: 3,
  docs: ['red-nombres', 'linux-apt', 'srv-samba-clientes'],
  items: [
    { id: 'llmnr', task: 1, weight: 2, check: ping('LNX-A', 'win-a') },
    { id: 'wins-linux', task: 2, weight: 2, check: ping('LNX-B', 'win-a') },
    { id: 'wins-windows', task: 3, check: ping('WIN-A', 'win-b') },
  ],
};

/** dns-reenvio: a mistyped forwarder, the guests left out of recursion, a record nobody added. */
const dnsForward: MissionPlan = {
  id: 'dns-reenvio',
  tasks: 3,
  docs: ['srv-dns', 'srv-dns-names', 'red-nombres'],
  items: [
    { id: 'forwarder', task: 1, weight: 2, check: { type: 'dns', from: 'PC0', name: 'www.google.com' } },
    { id: 'guests', task: 2, weight: 2, check: { type: 'dns', from: 'INVITADO', name: 'www.google.com' } },
    { id: 'record', task: 3, check: { type: 'dns', from: 'PC0', name: 'impresora.empresa.lan', ip: '192.168.50.60' } },
  ],
};

/** The missions, in the order of the Labs menu. */
export const MISSION_PLANS: readonly MissionPlan[] = [basico, basicoLinux, reservas, reservasLinux, relay, cliente, namesLan, namesNets, namesResolved, dnsForward];
