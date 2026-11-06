/**
 * kea-dhcp4.conf, ya aceptado por checkKeaConf (kea-dhcp4 -t), al modelo DHCP de Netfix: un pool por subnet4 con su
 * primer rango, el tiempo de concesión, match-client-id, las opciones que el modelo conoce (routers,
 * domain-name-servers, domain-name, netbios-name-servers), las reservas por MAC o client-id e interfaces-config.
 * Lo que el modelo no representa se queda fuera sin error, como lo acepta el comprobador real. Los límites son los de
 * persist.ts: lo que entra aquí lo escribió un usuario y se guarda con el laboratorio.
 */
import { broadcastOf, networkOf, inSubnet, parseIp } from '../core/ip.ts';
import { parseHexId, parseMac } from '../core/mac.ts';
import { parseKea } from './kea-json.ts';
import type { KeaMap, KeaNode } from './kea-json.ts';
import { KEA_TOPLEVEL } from './kea-schema.ts';
import type { DhcpReservation, PtDhcpPool } from './config.ts';
import { IFACE_NAME, MAX_LISTEN } from './listen.ts';

export interface KeaImport {
  readonly pools: PtDhcpPool[];
  /** Undefined: every interface (no interfaces-config, or "*"). */
  readonly interfaces?: string[];
}

const MAX_POOLS = 500;
const MAX_RESERVATIONS = 500;
/** A reservation's name as the model keeps it (shown in the GUI and the leases); any other is left out. */
const HOSTNAME = /^[A-Za-z0-9.-]{1,64}$/;
const MAX_CLIENT_ID_HEX = 510;
const MIN_PREFIX = 8;
const MAX_PREFIX = 30;
const MAX_USERS = 65_534;
const MAX_LEASE_MINUTES = 525_600;
/** Kea's default valid-lifetime (seconds). */
const DEFAULT_LIFETIME = 7200;
const DOMAIN = /^[A-Za-z0-9.-]{1,253}$/;
/** The options the model has, by name and by code. */
const OPTIONS: Readonly<Record<string, 'gateway' | 'dns' | 'domain' | 'wins'>> = {
  'routers': 'gateway', 'domain-name-servers': 'dns', 'domain-name': 'domain', 'netbios-name-servers': 'wins',
  '3': 'gateway', '6': 'dns', '15': 'domain', '44': 'wins',
};

type Options = Partial<Record<'gateway' | 'dns' | 'wins', number> & Record<'domain', string>>;
interface Net { readonly net: number; readonly prefix: number }

const str = (m: KeaMap, key: string): string | undefined => { const n = m.entries.get(key); return n?.kind === 'string' ? n.value : undefined; };
const int = (m: KeaMap, key: string): number | undefined => { const n = m.entries.get(key); return n?.kind === 'integer' ? n.value : undefined; };
const bool = (m: KeaMap, key: string): boolean | undefined => { const n = m.entries.get(key); return n?.kind === 'boolean' ? n.value : undefined; };
const mapsOf = (n: KeaNode | undefined): KeaMap[] => (n?.kind === 'list' ? n.items.filter((x): x is KeaMap => x.kind === 'map') : []);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function subnetOf(m: KeaMap): Net | undefined {
  const [addr = '', len = ''] = (str(m, 'subnet') ?? '').split('/');
  const ip = parseIp(addr);
  const prefix = Number(len);
  if (ip === null || !/^\d+$/.test(len) || prefix < MIN_PREFIX || prefix > MAX_PREFIX) return undefined;
  return { net: networkOf(ip, prefix), prefix };
}

/** The first pool, "first - last" or "net/len", within the usable addresses of the subnet. */
function firstRange(m: KeaMap, n: Net): { readonly start: number; readonly maxUsers: number } | undefined {
  const pool = mapsOf(m.entries.get('pools'))[0];
  const txt = (pool ? str(pool, 'pool') ?? '' : '').replace(/[ \t]/g, '');
  const slash = txt.indexOf('/');
  const [a = '', b = ''] = slash >= 0 ? [txt.slice(0, slash), txt.slice(slash + 1)] : txt.split('-');
  const first = parseIp(a);
  if (first === null) return undefined;
  const bits = Number(b);
  const range = slash >= 0 ? { lo: networkOf(first, bits), hi: broadcastOf(first, bits) } : { lo: first, hi: parseIp(b) ?? -1 };
  const start = clamp(range.lo, n.net + 1, broadcastOf(n.net, n.prefix) - 1);
  const last = clamp(range.hi, n.net + 1, broadcastOf(n.net, n.prefix) - 1);
  if (last < start) return undefined;
  return { start, maxUsers: Math.min(MAX_USERS, last - start + 1) };
}

/** option-data the model knows; the first address of a list. */
function optionsOf(list: KeaNode | undefined): Options {
  const out: Options = {};
  for (const o of mapsOf(list)) {
    if ((str(o, 'space') ?? 'dhcp4') !== 'dhcp4') continue;
    const key = str(o, 'name') ?? String(int(o, 'code') ?? '');
    const field = Object.hasOwn(OPTIONS, key) ? OPTIONS[key] : undefined;
    const data = (str(o, 'data') ?? '').split(',')[0]?.trim() ?? '';
    if (field === 'domain') {
      if (DOMAIN.test(data)) out.domain = data;
    } else if (field) {
      const a = parseIp(data);
      if (a !== null) out[field] = a;
    }
  }
  return out;
}

function reservationOf(h: KeaMap, n: Net): DhcpReservation | undefined {
  const ip = parseIp(str(h, 'ip-address') ?? '');
  if (ip === null || !inSubnet(ip, n.net, n.prefix)) return undefined;
  const hw = str(h, 'hw-address');
  const cid = str(h, 'client-id');
  const mac = hw !== undefined ? parseMac(hw) : null;
  const clientId = hw === undefined && cid !== undefined ? parseHexId(cid) : null;
  if (mac === null && (clientId === null || clientId.length > MAX_CLIENT_ID_HEX)) return undefined;
  const name = str(h, 'hostname') ?? '';
  return { ip, ...(mac !== null ? { mac } : { clientId: clientId ?? '' }), ...(HOSTNAME.test(name) ? { name } : {}) };
}

function reservationsOf(m: KeaMap, n: Net): DhcpReservation[] {
  return mapsOf(m.entries.get('reservations')).slice(0, MAX_RESERVATIONS).flatMap((h) => reservationOf(h, n) ?? []);
}

function poolOf(m: KeaMap, index: number, dhcp4: KeaMap, global: Options, current: readonly PtDhcpPool[]): PtDhcpPool | undefined {
  const n = subnetOf(m);
  const range = n ? firstRange(m, n) : undefined;
  if (!n || !range) return undefined;
  const same = current.find((p) => p.prefix === n.prefix && networkOf(p.start, p.prefix) === n.net);
  const lifetime = int(m, 'valid-lifetime') ?? int(dhcp4, 'valid-lifetime') ?? DEFAULT_LIFETIME;
  const byMac = (bool(m, 'match-client-id') ?? bool(dhcp4, 'match-client-id')) === false;
  return {
    name: same?.name ?? `subnet${int(m, 'id') ?? index + 1}`,
    start: range.start, prefix: n.prefix, maxUsers: range.maxUsers,
    leaseMinutes: clamp(Math.round(lifetime / 60), 1, MAX_LEASE_MINUTES),
    ...(byMac ? { identifyBy: 'mac' as const } : {}),
    ...global, ...optionsOf(m.entries.get('option-data')),
    ...(same?.tftp !== undefined ? { tftp: same.tftp } : {}),
    reservations: reservationsOf(m, n),
  };
}

/** interfaces-config: names without "/address", the ones the model knows; "*" is every interface. */
function interfacesOf(dhcp4: KeaMap): string[] | undefined {
  const cfg = dhcp4.entries.get('interfaces-config');
  const list = cfg?.kind === 'map' ? cfg.entries.get('interfaces') : undefined;
  if (list?.kind !== 'list') return undefined;
  const names = list.items.flatMap((x) => (x.kind === 'string' ? [x.value.split('/')[0] ?? ''] : []));
  if (names.includes('*')) return undefined;
  return [...new Set(names.filter((x) => IFACE_NAME.test(x)))].slice(0, MAX_LISTEN);
}

/** The checked file as Netfix's DHCP; `current` keeps the names (and TFTP) of pools on the same network. */
export function importKea(text: string, current: readonly PtDhcpPool[]): KeaImport | undefined {
  const root = parseKea(text, '', KEA_TOPLEVEL).root;
  const dhcp4 = root?.entries.get('Dhcp4');
  if (dhcp4?.kind !== 'map') return undefined;
  const global = optionsOf(dhcp4.entries.get('option-data'));
  const subnets = mapsOf(dhcp4.entries.get('subnet4')).slice(0, MAX_POOLS);
  const pools = subnets.flatMap((m, i) => poolOf(m, i, dhcp4, global, current) ?? []);
  const interfaces = interfacesOf(dhcp4);
  return interfaces === undefined ? { pools } : { pools, interfaces };
}
