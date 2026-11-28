/**
 * The labs by theme, in the order of the Labs menu (each lab in exactly one group: tests/net/lab-groups.test.ts).
 * Plain data with no imports, so the documentation can use it without pulling in the simulator.
 */
export type LabGroupId = 'dhcp' | 'switching' | 'services' | 'names' | 'internet' | 'security';

const groups: [LabGroupId, string[]][] = [
  ['dhcp', ['basico', 'basico-linux', 'reservas', 'reservas-linux', 'relay', 'cliente']],
  ['switching', ['vlans', 'stp', 'snooping']],
  ['services', ['servidores', 'ssh-sftp', 'samba']],
  ['names', ['nombres-lan', 'nombres-redes', 'nombres-resolved', 'dns-reenvio']],
  ['internet', ['internet', 'vpn-ipsec', 'vpn-wireguard']],
  ['security', ['linux-dmz', 'bastionado']],
];
export const LAB_GROUPS: readonly (readonly [LabGroupId, readonly string[]])[] = groups;

/** An extension's lab at the end of `group` (labs/extension-labs.ts registerLab). */
export function addToGroup(group: LabGroupId, id: string): void {
  groups.find(([g]) => g === group)?.[1].push(id);
}
