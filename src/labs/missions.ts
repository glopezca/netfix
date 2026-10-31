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

const CHANGES: Readonly<Record<string, Changes>> = {
  basico: { start: (t) => ios(t, 'GW', 'ip dhcp pool LAN\n no default-router\n no dns-server') },
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
