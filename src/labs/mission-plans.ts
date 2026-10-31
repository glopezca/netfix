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

const relay: MissionPlan = {
  id: 'relay',
  tasks: 3,
  docs: ['ios-relay', 'red-broadcast', 'ios-dhcp'],
  items: [
    { id: 'helper', task: 1, weight: 2, check: { type: 'config', device: 'EDGE', section: 'interface GigabitEthernet0/1', lines: [' ip helper-address 10.0.0.1'] } },
    { id: 'route', task: 2, weight: 2, check: { type: 'config', device: 'DHCP-SRV', lines: ['ip route 10.20.0.0 255.255.255.0 10.0.0.2'] } },
    { id: 'pc0', task: 3, check: lease('PC0', '10.20.0.0/24', '10.20.0.1') },
    { id: 'pc1', task: 3, check: lease('PC1', '10.20.0.0/24', '10.20.0.1') },
    { id: 'ping', task: 3, check: { type: 'ping', from: 'PC0', to: '10.0.0.1', expect: 'success' } },
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

/** The missions, in the order of the Labs menu. */
export const MISSION_PLANS: readonly MissionPlan[] = [basico, relay, namesNets];
