/**
 * kea-dhcp4 -t (Kea 2.6): lee kea-dhcp4.conf con kea-json.ts y lo configura sin aplicarlo, en el orden de
 * configureDhcp4Server: opciones globales, interfaces, subredes (pools, opciones, la subred, reservas) y reservas
 * globales. Devuelve el registro que Kea escribe en la salida estándar y el error que escribe en la de errores.
 */
import { formatIp, inSubnet, networkOf, broadcastOf, parseIp } from '../core/ip.ts';
import { parseKea } from './kea-json.ts';
import type { KeaMap, KeaNode } from './kea-json.ts';
import { DHCP4_OPTIONS, KEA_TOPLEVEL } from './kea-schema.ts';
import type { OptionDef } from './kea-schema.ts';

export interface KeaLog {
  readonly level: 'INFO' | 'WARN' | 'ERROR';
  readonly logger: 'dhcp4' | 'dhcpsrv';
  readonly message: string;
}

export interface KeaCheck {
  readonly ok: boolean;
  readonly log: readonly KeaLog[];
  /** Lo que kea-dhcp4 escribe en la salida de errores al fallar. */
  readonly error?: string;
}

class ConfigError extends Error {}

interface Run { readonly file: string; readonly log: KeaLog[]; readonly global: KeaMap }
interface Net { readonly net: number; readonly prefix: number; readonly text: string }
interface Range { readonly first: number; readonly last: number }

const SUBNET_FAILED = 'subnet configuration failed: ';
const IDENTIFIERS = ['hw-address', 'duid', 'circuit-id', 'client-id', 'flex-id'];

const where = (r: Run, n: KeaNode): string => `${r.file}:${n.pos.line}:${n.pos.col}`;
const badAddress = (text: string): string => `Failed to convert string to address '${text}': Invalid argument`;

function str(m: KeaMap, key: string): (KeaNode & { kind: 'string' }) | undefined {
  const n = m.entries.get(key);
  return n?.kind === 'string' ? n : undefined;
}

function num(m: KeaMap, key: string): number | undefined {
  const n = m.entries.get(key);
  return n?.kind === 'integer' ? n.value : undefined;
}

const mapsOf = (n: KeaNode | undefined): KeaMap[] => (n?.kind === 'list' ? n.items.filter((x): x is KeaMap => x.kind === 'map') : []);

function optionDef(name: string | undefined, code: number | undefined): OptionDef | undefined {
  if (name !== undefined) return Object.hasOwn(DHCP4_OPTIONS, name) ? DHCP4_OPTIONS[name] : undefined;
  return Object.values(DHCP4_OPTIONS).find((d) => d.code === code);
}

/** option-data: el nombre ha de ser una opción conocida y las direcciones, direcciones. */
function checkOptions(r: Run, list: KeaNode | undefined): void {
  for (const o of mapsOf(list)) {
    const space = str(o, 'space')?.value ?? 'dhcp4';
    if (space !== 'dhcp4') continue;
    const name = str(o, 'name');
    const code = num(o, 'code');
    const d = optionDef(name?.value, code);
    if (!d) {
      if (name) throw new ConfigError(`definition for the option '${space}.${name.value}' having code '${code ?? 0}' does not exist (${where(r, name)})`);
      continue;
    }
    const data = str(o, 'data');
    const csv = o.entries.get('csv-format');
    if (!data || d.type === 'other' || (csv?.kind === 'boolean' && !csv.value)) continue;
    for (const a of data.value.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (parseIp(a) === null) {
        throw new ConfigError(`option data does not match option definition (space: ${space}, code: ${d.code}): ${badAddress(a)} (${where(r, data)})`);
      }
    }
  }
}

/** Un pool «primera - última» o «red/prefijo»; Kea quita antes los espacios. */
function poolRange(r: Run, pool: KeaNode & { kind: 'string' }): Range {
  const txt = pool.value.replace(/[ \t]/g, '');
  const at = `(${where(r, pool)})`;
  const slash = txt.indexOf('/');
  const dash = txt.indexOf('-');
  if (slash < 0 && dash < 0) {
    throw new ConfigError(`invalid pool definition: ${pool.value}. There are two acceptable formats <min address-max address> or <prefix/len> ${at}`);
  }
  const [a = '', b = ''] = slash >= 0 ? [txt.slice(0, slash), txt.slice(slash + 1)] : [txt.slice(0, dash), txt.slice(dash + 1)];
  const first = parseIp(a);
  const other = slash >= 0 ? (/^\d+$/.test(b) ? Number(b) : null) : parseIp(b);
  if (first === null || other === null) throw new ConfigError(`Failed to parse pool definition: ${txt} ${at}`);
  if (slash >= 0) {
    if (other > 32) throw new ConfigError(`Failed to create pool defined by: ${txt} ${at}`);
    return { first: networkOf(first, other), last: broadcastOf(first, other) };
  }
  if (other < first) throw new ConfigError(`Failed to create pool defined by: ${txt} ${at}`);
  return { first, last: other };
}

function pools(r: Run, subnet: KeaMap): Range[] {
  return mapsOf(subnet.entries.get('pools')).map((p) => {
    const pool = str(p, 'pool');
    if (!pool) throw new ConfigError(`missing parameter 'pool' (${where(r, p)})`);
    const range = poolRange(r, pool);
    checkOptions(r, p.entries.get('option-data'));
    return range;
  });
}

function subnetOf(r: Run, m: KeaMap): Net {
  const s = str(m, 'subnet');
  if (!s) throw new ConfigError(`${SUBNET_FAILED}mandatory 'subnet' parameter is missing for a subnet being configured (${where(r, m)})`);
  const [addr = '', len, extra] = s.value.split('/');
  if (len === undefined || extra !== undefined || !/^\d+$/.test(len)) {
    throw new ConfigError(`${SUBNET_FAILED}Invalid subnet syntax (prefix/len expected):${s.value} (${where(r, s)})`);
  }
  const ip = parseIp(addr);
  if (ip === null) throw new ConfigError(`${SUBNET_FAILED}${badAddress(addr)}`);
  if (Number(len) > 32) throw new ConfigError(`${SUBNET_FAILED}Invalid prefix length specified for subnet: ${len}`);
  return { net: ip, prefix: Number(len), text: `${formatIp(ip)}/${len}` };
}

/** La subred con sus pools; como Subnet4ConfigParser, anuncia la subred con sus tiempos (heredados de Dhcp4). */
function createSubnet(r: Run, m: KeaMap, ranges: readonly Range[]): Net {
  const net = subnetOf(r, m);
  const text = (x: Range): string => `${formatIp(x.first)}-${formatIp(x.last)}`;
  ranges.forEach((x, i) => {
    const fail = (what: string): ConfigError => new ConfigError(`${SUBNET_FAILED}a pool of type V4, with the following address range: ${text(x)} ${what} ${net.text} to which it is being added. (${where(r, m)})`);
    if (!inSubnet(x.first, net.net, net.prefix) || !inSubnet(x.last, net.net, net.prefix)) throw fail('does not match the prefix of a subnet:');
    if (ranges.slice(0, i).some((y) => x.first <= y.last && y.first <= x.last)) throw fail('overlaps with an existing pool in the subnet:');
  });
  const inherited = (key: string): number | undefined => num(m, key) ?? num(r.global, key);
  const params = [['t1', 'renew-timer'], ['t2', 'rebind-timer'], ['valid-lifetime', 'valid-lifetime']]
    .flatMap(([label, key]) => { const v = inherited(key ?? ''); return v === undefined ? [] : [`${label}=${v}`]; });
  r.log.push({ level: 'INFO', logger: 'dhcpsrv', message: `DHCPSRV_CFGMGR_NEW_SUBNET4 a new subnet has been added to configuration: ${net.text} with params: ${params.join(', ')}` });
  return net;
}

function checkReservations(r: Run, list: KeaNode | undefined, net: Net | undefined): void {
  for (const h of mapsOf(list)) {
    if (!IDENTIFIERS.some((k) => h.entries.has(k))) {
      throw new ConfigError(`one of the supported identifiers must be specified for host reservation: ${IDENTIFIERS.join(' ')} (${where(r, h)})`);
    }
    checkOptions(r, h.entries.get('option-data'));
    const ip = str(h, 'ip-address');
    if (!ip) continue;
    const a = parseIp(ip.value);
    if (a === null) throw new ConfigError(`${badAddress(ip.value)} (${where(r, ip)})`);
    if (net && !inSubnet(a, net.net, net.prefix)) throw new ConfigError(`specified reservation '${formatIp(a)}' is not within the IPv4 subnet '${net.text}'`);
  }
}

function checkSubnets(r: Run, list: KeaNode | undefined): void {
  const ids = new Set<number>();
  const prefixes = new Set<string>();
  for (const m of mapsOf(list)) {
    const ranges = pools(r, m);
    checkOptions(r, m.entries.get('option-data'));
    const net = createSubnet(r, m, ranges);
    checkReservations(r, m.entries.get('reservations'), net);
    const id = num(m, 'id');
    if (id !== undefined && ids.has(id)) throw new ConfigError(`ID of the new IPv4 subnet '${id}' is already in use (${where(r, m)})`);
    if (prefixes.has(net.text)) throw new ConfigError(`subnet with the prefix of '${net.text}' already exists (${where(r, m)})`);
    if (id !== undefined) ids.add(id);
    prefixes.add(net.text);
  }
}

function checkInterfaces(r: Run, cfg: KeaNode | undefined): void {
  if (cfg?.kind !== 'map') return;
  const type = str(cfg, 'dhcp-socket-type');
  if (!type) r.log.push({ level: 'INFO', logger: 'dhcpsrv', message: 'DHCPSRV_CFGMGR_SOCKET_TYPE_DEFAULT "dhcp-socket-type" not specified , using default socket type raw' });
  else if (type.value !== 'raw' && type.value !== 'udp') throw new ConfigError(`unsupported socket type '${type.value}'`);
}

const STEPS: readonly (readonly [string, (r: Run, n: KeaNode | undefined) => void])[] = [
  ['option-data', checkOptions],
  ['interfaces-config', checkInterfaces],
  ['subnet4', checkSubnets],
  ['reservations', (r, n) => { checkReservations(r, n, undefined); }],
];

/** `kea-dhcp4 -t ARCHIVO`: el texto del archivo o por qué no se pudo leer. */
export function checkKeaConf(path: string, text: string | { readonly error: string }): KeaCheck {
  if (typeof text !== 'string') return { ok: false, log: [], error: `Syntax check failed with: Unable to open file ${path}` };
  const parsed = parseKea(text, path, KEA_TOPLEVEL);
  const log: KeaLog[] = parsed.warnings.map((w) => ({ level: 'WARN', logger: 'dhcp4', message: `DHCP4_CONFIG_SYNTAX_WARNING configuration syntax warning: ${w}` }));
  if (!parsed.root) return { ok: false, log, error: `Syntax check failed with: ${parsed.error ?? ''}` };
  const dhcp4 = parsed.root.entries.get('Dhcp4');
  if (dhcp4?.kind !== 'map') return { ok: false, log, error: 'Missing mandatory Dhcp4 element' };
  const r: Run = { file: path, log, global: dhcp4 };
  for (const [element, step] of STEPS) {
    try {
      step(r, dhcp4.entries.get(element));
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      log.push({ level: 'ERROR', logger: 'dhcp4', message: `DHCP4_PARSER_FAIL failed to create or run parser for configuration element ${element}: ${err.message}` });
      return { ok: false, log, error: `Error encountered: ${err.message}` };
    }
  }
  return { ok: true, log };
}
