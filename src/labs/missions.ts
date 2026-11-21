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
import { Router } from '../devices/router.ts';
import { clientIdFromMac, formatHexId, formatMacCisco } from '../core/mac.ts';
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

const WAN = 'GigabitEthernet0/1';

/** The ISP keyed the CPE's fixed lease as if it were a PC (01 + MAC) and lost the pool's gateway; the CPE asks for nothing. */
function breakClient(t: Topology): void {
  const cpe = t.byLabel('CPE');
  if (!(cpe instanceof Router)) throw new Error('mission: CPE is not a router');
  ios(t, 'ISP', `ip dhcp pool CPE-FIJO
 no client-identifier ${cpe.plane.clientIdText(WAN)}
 client-identifier ${pcId(cpe.ifaceMac(WAN))}
ip dhcp pool CLIENTES
 no default-router`);
  ios(t, 'CPE', `interface ${WAN}\n no ip address dhcp\n no ip address`);
}

const CHANGES: Readonly<Record<string, Changes>> = {
  basico: { start: (t) => ios(t, 'GW', 'ip dhcp pool LAN\n no default-router\n no dns-server') },
  reservas: { start: breakReservations },
  cliente: { start: breakClient },
  relay: {
    start: (t) => {
      ios(t, 'EDGE', 'interface GigabitEthernet0/1\n no ip helper-address 10.0.0.1');
      ios(t, 'DHCP-SRV', 'no ip route 10.20.0.0 255.255.255.0 10.0.0.2');
    },
  },
  'nombres-redes': { solve: (t) => addDnsRecord(t, 'SRV', 'aula.lab', { name: 'win-b2', type: 'A', value: '192.168.20.12', ttl: 86400 }) },
};

/** The missions, in the order of the Labs menu. */
export const MISSIONS: readonly Mission[] = MISSION_PLANS.map((p) => ({ ...p, ...CHANGES[p.id] }));

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
