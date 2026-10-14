/** Kinds of end devices and what they run (a leaf module: shells use it instead of importing Server). */

export type HostKind = 'pc' | 'server' | 'linuxrouter';

/** Server and the Linux router run the Ubuntu Server software (services, systemd units, admin users). */
export function runsServices(kind: string): boolean {
  return kind === 'server' || kind === 'linuxrouter';
}
