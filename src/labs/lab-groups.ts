/**
 * The labs by theme, in the order of the Labs menu (each lab in exactly one group: tests/net/lab-groups.test.ts).
 * Plain data with no imports, so the documentation can use it without pulling in the simulator.
 */
export type LabGroupId = 'dhcp' | 'switching' | 'services' | 'names' | 'internet' | 'security';

export const LAB_GROUPS: readonly (readonly [LabGroupId, readonly string[]])[] = [
  ['dhcp', ['basico', 'reservas', 'relay', 'cliente']],
  ['switching', ['vlans', 'stp', 'snooping']],
  ['services', ['servidores', 'ssh-sftp']],
  ['names', ['nombres-lan', 'nombres-redes', 'dns-reenvio']],
  ['internet', ['internet', 'vpn-ipsec', 'vpn-wireguard']],
  ['security', ['linux-dmz', 'bastionado']],
];
