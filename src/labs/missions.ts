/**
 * Guided labs (missions): a lab that starts broken or unfinished, a client's ticket, numbered tasks with three hints
 * each and a rubric the marking checks. The lab's own build is the reference; `start` breaks it into the starting
 * state, `solve` finishes what the lab leaves for the student. The plan (tasks, rubric) is in mission-plans.ts and
 * the texts in the catalogue (mission.<id>.*).
 */
import type { Topology } from '../net/topology.ts';
import { IosDevice } from '../ios/device.ts';
import { applyConfig } from '../ios/session.ts';
import { Server } from '../devices/server.ts';
import { Host } from '../devices/host.ts';
import { LinuxRouter } from '../devices/linux-router.ts';
import { rootScript } from '../net/labs-linux.ts';
import { cpeNetplan, RELAY_FILE } from '../net/labs-dhcp-linux.ts';
import type { PtDhcpPool } from '../services/config.ts';
import { clientIdFromMac, formatHexId, formatMacCisco } from '../core/mac.ts';
import { parseIp } from '../core/ip.ts';
import { createShell } from '../shells/factory.ts';
import { setWindowsWins } from '../net/win-wins.ts';
import type { DnsRecord } from '../services/config.ts';
import { MISSION_PLANS } from './mission-plans.ts';
import type { MissionPlan } from './mission-plans.ts';

export interface Mission extends MissionPlan {
  /** Turns the lab into the starting state. */
  readonly start?: (t: Topology) => void;
  /** What the student has to do, when the lab itself starts unfinished. */
  readonly solve?: (t: Topology) => void;
}

type Changes = Pick<Mission, 'start' | 'solve'>;

/** Runs IOS configuration lines (from global configuration mode) on the device called `label`. */
function ios(t: Topology, label: string, lines: string): void {
  const d = t.byLabel(label);
  if (!(d instanceof IosDevice)) throw new Error(`mission: ${label} is not an IOS device`);
  applyConfig(d, lines.trim().split('\n'));
}

function addDnsRecord(t: Topology, label: string, zone: string, record: DnsRecord): void {
  const srv = t.byLabel(label);
  if (!(srv instanceof Server)) throw new Error(`mission: ${label} is not a server`);
  const dns = srv.services.dns;
  const zones = dns.zones.map((z) => (z.name === zone ? { ...z, records: [...z.records, record] } : z));
  srv.setServices({ ...srv.services, dns: { ...dns, zones } });
}

function host(t: Topology, label: string): Host {
  const d = t.byLabel(label);
  if (!(d instanceof Host)) throw new Error(`mission: ${label} is not a host`);
  return d;
}

const pcId = (mac: string): string => formatHexId(clientIdFromMac(mac));
/** A MAC with its last digit mistyped. */
const typo = (mac: string): string => mac.slice(0, -1) + (mac.endsWith('a') ? 'b' : 'a');

/** Three fixed addresses, three classic slips: the id without its 01, a mistyped MAC, a line copied from another PC. */
function breakReservations(t: Topology): void {
  const [pc0, pc1] = [host(t, 'PC0').mac, host(t, 'PC1').mac];
  ios(t, 'GW', `ip dhcp pool PC0-FIJO
 no client-identifier ${pcId(pc0)}
 client-identifier ${formatMacCisco(pc0)}
ip dhcp pool PC1-FIJO
 no hardware-address ${formatMacCisco(pc1)}
 hardware-address ${formatMacCisco(typo(pc1))}
ip dhcp pool LAN
 no address 192.168.10.150
 address 192.168.10.150 client-id ${pcId(pc1)}`);
  host(t, 'PC2').releaseDhcp(); // reinstalled: it asks from scratch, not for the address it had
  t.settle();
}

function linuxRouter(t: Topology, label: string): LinuxRouter {
  const d = t.byLabel(label);
  if (!(d instanceof LinuxRouter)) throw new Error(`mission: ${label} is not a GNU/Linux router`);
  return d;
}

/** The PCs forget their lease and ask from scratch, as after a reinstall or a reboot. */
function renew(t: Topology, labels: readonly string[]): void {
  t.settle();
  for (const l of labels) host(t, l).releaseDhcp();
  t.settle();
}

/** Kea on `label` with its only pool changed by `edit`. */
function keaPool(t: Topology, label: string, edit: (p: PtDhcpPool) => PtDhcpPool): void {
  const r = linuxRouter(t, label);
  r.setServices({ ...r.services, dhcp: { ...r.services.dhcp, pools: r.services.dhcp.pools.map(edit) } });
}

const PCS = ['PC0', 'PC1', 'PC2'];

/** The technician "cleaned" Kea's pool: no routers and no domain-name-servers in its option-data. */
function breakBasicoLinux(t: Topology): void {
  keaPool(t, 'GW', ({ gateway: _g, dns: _d, ...rest }) => rest);
  renew(t, PCS);
}

/** The three slips of reservas, in Kea: a client-id without its 01, a mistyped hw-address, PC1's client-id on .150. */
function breakReservasLinux(t: Topology): void {
  const [pc0, pc1] = [host(t, 'PC0').mac, host(t, 'PC1').mac];
  keaPool(t, 'GW', (p) => ({ ...p, reservations: [
    { ip: parseIp('192.168.10.100') ?? 0, clientId: clientIdFromMac(pc0).slice(2), name: 'pc0' },
    { ip: parseIp('192.168.10.101') ?? 0, mac: typo(pc1), name: 'pc1' },
    { ip: parseIp('192.168.10.150') ?? 0, clientId: clientIdFromMac(pc1), name: 'pc2' },
  ] }));
  renew(t, PCS);
}

/** The intern left the relay as Ubuntu installs it, and DHCP-SRV with no way back to the branch. */
function breakRelay(t: Topology): void {
  rootScript(linuxRouter(t, 'EDGE'), `systemctl disable --now isc-dhcp-relay
sed -i 's/^SERVERS=.*/SERVERS=""/; s/^INTERFACES=.*/INTERFACES=""/' ${RELAY_FILE}`);
  const srv = t.byLabel('DHCP-SRV');
  if (!(srv instanceof Server)) throw new Error('mission: DHCP-SRV is not a server');
  const { gateway: _g, ...noGateway } = srv.config;
  srv.setStatic({ ...noGateway, ip: srv.config.ip ?? 0, prefix: srv.config.prefix ?? 30 });
  renew(t, ['PC0', 'PC1']);
}

/** The ISP keyed CPE's fixed lease by its bare MAC (no 01) and lost the pool's gateway; CPE asks for nothing. */
function breakClient(t: Topology): void {
  const cpe = linuxRouter(t, 'CPE');
  ios(t, 'ISP', `ip dhcp pool CPE-FIJO
 no client-identifier ${formatHexId(clientIdFromMac(cpe.mac))}
 client-identifier ${formatHexId(cpe.mac)}
ip dhcp pool CLIENTES
 no default-router`);
  rootScript(cpe, cpeNetplan(false));
  t.settle();
}

/** Runs commands as root in the GNU/Linux terminal of `label` (history expansion off). */
function rootOn(t: Topology, label: string, script: string): void {
  const sh = createShell(host(t, label), 'linux', 'root');
  sh.run('set +H');
  sh.run(script.trim());
}

/** LNX2: avahi for .local, win1 in /etc/hosts, samba so that Windows finds it by NetBIOS. */
function solveNamesLan(t: Topology): void {
  rootOn(t, 'LNX2', `apt install -y avahi-daemon samba
echo '192.168.1.11 win1' >> /etc/hosts`);
  t.net.runFor(2000);
}

/** LLMNR in resolved + libnss-resolve on LNX-A; WINS in smb.conf and nsswitch on LNX-B; WIN-B's WINS server. */
function solveNamesResolved(t: Topology): void {
  rootOn(t, 'LNX-A', `sed -i 's/^#LLMNR=no/LLMNR=yes/' /etc/systemd/resolved.conf
systemctl restart systemd-resolved
apt install -y libnss-resolve`);
  rootOn(t, 'LNX-B', `apt install -y samba winbind libnss-winbind
sed -i 's/^   workgroup = WORKGROUP$/&\\n   wins server = 192.168.10.2/' /etc/samba/smb.conf
systemctl restart nmbd
sed -i 's/^hosts:.*/& wins/' /etc/nsswitch.conf`);
  setWindowsWins(host(t, 'WIN-B'), parseIp('192.168.10.2') ?? 0);
  t.net.runFor(1000);
}

function dnsOf(t: Topology): { srv: Server; dns: Server['services']['dns'] } {
  const srv = t.byLabel('NS1');
  if (!(srv instanceof Server)) throw new Error('mission: NS1 is not a server');
  return { srv, dns: srv.services.dns };
}

/** The new technician typed 8.8.8.9 and dropped 8.8.4.4: with forward only, every Internet name fails. */
function breakForwarders(t: Topology): void {
  const { srv, dns } = dnsOf(t);
  srv.setServices({ ...srv.services, dns: { ...dns, forwarders: [parseIp('8.8.8.9') ?? 0] } });
  t.settle();
}

/** Recursion for the guest network too, and the printer in the zone. */
function solveDnsForward(t: Topology): void {
  const { srv, dns } = dnsOf(t);
  srv.setServices({ ...srv.services, dns: { ...dns, allowRecursion: [...(dns.allowRecursion ?? []), '192.168.60.0/24'] } });
  addDnsRecord(t, 'NS1', 'empresa.lan', { name: 'impresora', type: 'A', value: '192.168.50.60', ttl: 86400 });
  t.settle();
}

const CHANGES: Readonly<Record<string, Changes>> = {
  basico: { start: (t) => ios(t, 'GW', 'ip dhcp pool LAN\n no default-router\n no dns-server') },
  'basico-linux': { start: breakBasicoLinux },
  reservas: { start: breakReservations },
  'reservas-linux': { start: breakReservasLinux },
  relay: { start: breakRelay },
  cliente: { start: breakClient },
  'nombres-lan': { solve: solveNamesLan },
  'nombres-resolved': { solve: solveNamesResolved },
  'dns-reenvio': { start: breakForwarders, solve: solveDnsForward },
  'nombres-redes': { solve: (t) => addDnsRecord(t, 'SRV', 'aula.lab', { name: 'win-b2', type: 'A', value: '192.168.20.12', ttl: 86400 }) },
};

/** The missions, in the order of the Labs menu. */
export const MISSIONS: readonly Mission[] = MISSION_PLANS.map((p) => ({ ...p, ...CHANGES[p.id] }));

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
