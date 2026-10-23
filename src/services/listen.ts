/**
 * Listen interfaces of the DHCP and DNS services, as Kea (`interfaces-config`) and BIND (`listen-on`) have them.
 * Interfaces are Linux names (eth0…, and lo for DNS); no list means every interface (`*` / `any`).
 */
import { t } from '../i18n/t.ts';
import type { DnsSettings, ServerServices } from './config.ts';
import type { NicInfo } from '../devices/host-nics.ts';
import { formatIp } from '../core/ip.ts';

export const LOOPBACK = 'lo';
const LOOPBACK_IP = 0x7f000001;
export const MAX_LISTEN = 8;
/** Linux interface names a saved file may carry. */
export const IFACE_NAME = /^(?:eth\d{1,2}|lo)$/;

export interface ListenChoice {
  readonly name: string;
  /** Device port (GigabitEthernet0/1…); undefined for lo. */
  readonly port?: string;
  readonly ip?: number;
  /** a.b.c.d/prefix when the interface has an address. */
  readonly address?: string;
}

/** The interfaces a service can listen on: the NICs and, for DNS, lo. */
export function listenChoices(host: { nics(): NicInfo[] }, withLoopback: boolean): ListenChoice[] {
  const nics = host.nics().map((n) => ({ name: n.linux, port: n.port, ip: n.ip, ...(n.ip !== undefined && n.prefix !== undefined ? { address: `${formatIp(n.ip)}/${n.prefix}` } : {}) }));
  return withLoopback ? [...nics, { name: LOOPBACK, ip: LOOPBACK_IP, address: '127.0.0.1/8' }] : nics;
}

/** Whether a list (undefined = all) includes the interface. */
export const listens = (list: readonly string[] | undefined, iface: string): boolean => list === undefined || list.includes(iface);

function validate(list: readonly string[], available: readonly string[]): string | null {
  if (list.length === 0) return t('listen.err.none');
  const bad = list.find((n) => !available.includes(n));
  return bad === undefined ? null : t('listen.err.unknown', { name: bad });
}

/** Kea's interfaces-config: undefined = all ("*"). */
export function setDhcpInterfaces(s: ServerServices, list: readonly string[] | undefined, available: readonly string[]): ServerServices | { error: string } {
  if (list === undefined) return { ...s, dhcp: { ...s.dhcp, interfaces: undefined } };
  const err = validate(list, available);
  return err ? { error: err } : { ...s, dhcp: { ...s.dhcp, interfaces: [...new Set(list)] } };
}

/** BIND's listen-on: undefined = any. */
export function setDnsListen(s: DnsSettings, list: readonly string[] | undefined, available: readonly string[]): DnsSettings | { error: string } {
  if (list === undefined) return { ...s, listenOn: undefined };
  const err = validate(list, available);
  return err ? { error: err } : { ...s, listenOn: [...new Set(list)] };
}

/** The addresses BIND listens on (listen-on); undefined = any. */
export function dnsListenAddresses(s: DnsSettings, choices: readonly ListenChoice[]): number[] | undefined {
  if (s.listenOn === undefined) return undefined;
  return s.listenOn.map((n) => choices.find((c) => c.name === n)?.ip).filter((x): x is number => x !== undefined);
}

/** Whether a query to `dst` reaches bind (127.x is the loopback). */
export function dnsListensOn(s: DnsSettings, choices: readonly ListenChoice[], dst: number): boolean {
  const addrs = dnsListenAddresses(s, choices);
  if (addrs === undefined) return true;
  return addrs.includes(dst) || ((dst >>> 24) === 127 && listens(s.listenOn, LOOPBACK));
}

/** The interfaces of listen-on addresses (as named.conf.options lists them); unknown addresses are ignored. */
export function ifacesOfAddresses(addresses: readonly number[], choices: readonly ListenChoice[]): string[] {
  return [...new Set(addresses.map((a) => ((a >>> 24) === 127 ? LOOPBACK : choices.find((c) => c.ip === a)?.name)).filter((x): x is string => x !== undefined))];
}
