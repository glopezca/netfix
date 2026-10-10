/** Callbacks a device uses to talk to the network it is attached to. */
import type { Frame } from '../net/packets.ts';

export interface DeviceHooks {
  /** True when the port has a cable whose far end is administratively up. */
  peerUp(port: string): boolean;
  /** Port admin state changed: the network re-evaluates the link and notifies the peer. */
  portChanged(port: string): void;
  /** Transmit a frame out of a physical port. */
  transmit(port: string, frame: Frame): void;
  /** Run `fn` after `delayMs` of simulated time. */
  schedule(delayMs: number, fn: () => void, label?: string): void;
  /** Network-wide check used by the DHCP server's ping-before-offer. */
  ipInUse(ip: number, exceptDevice: string): boolean;
}

export const DETACHED: DeviceHooks = {
  peerUp: () => false,
  portChanged: () => undefined,
  transmit: () => undefined,
  schedule: () => undefined,
  ipInUse: () => false,
};

/** Adds `n` to the last 24 bits of a MAC (consecutive interface MACs). */
export function macPlus(mac: string, n: number): string {
  const oui = mac.slice(0, 6);
  const nic = (parseInt(mac.slice(6), 16) + n) & 0xffffff;
  return `${oui}${nic.toString(16).padStart(6, '0')}`;
}
