/** Static data for the 2960 model (kept separate to avoid an import cycle). */
const FAST_PORTS = 24;
const GIG_PORTS = 2;
export const DEFAULT_VLANS: ReadonlyMap<number, string> = new Map([
  [1, 'default'], [1002, 'fddi-default'], [1003, 'token-ring-default'], [1004, 'fddinet-default'], [1005, 'trnet-default'],
]);

export const SWITCH_PORTS: readonly string[] = [
  ...Array.from({ length: FAST_PORTS }, (_, i) => `FastEthernet0/${i + 1}`),
  ...Array.from({ length: GIG_PORTS }, (_, i) => `GigabitEthernet0/${i + 1}`),
];

