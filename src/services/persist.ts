/** JSON (de)serialisation of Server services with validation of untrusted files. */
import type { ServerServices, PtDhcpPool, DnsRecord, Account, WebFile } from './config.ts';
import { defaultServices, defaultWebApps, validateAccess, DEFAULT_LEASE_MINUTES, DEFAULT_TTL } from './config.ts';
import type { WebAppAccess, WebApps } from './config.ts';
import type { MailMessage } from '../net/packets.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { parseMac, parseHexId } from '../core/mac.ts';
import { cleanOrigin, validateOrigin } from './dns-names.ts';

type Json = Record<string, unknown>;

const MAX_ITEMS = 500;
const MAX_TEXT = 200_000;
const RECORD_TYPES = new Set(['A', 'CNAME', 'MX', 'NS', 'TXT']);

export interface ServicesJson {
  readonly dhcp: { enabled: boolean; pools: Json[] };
  readonly dns: { enabled: boolean; origin?: string; records: DnsRecord[] };
  readonly http: { enabled: boolean; files: WebFile[] };
  readonly mail: ServerServices['mail'];
  readonly ssh: ServerServices['ssh'];
  readonly webapps?: ServerServices['webapps'];
}

const ip = (n: number | undefined): string | undefined => (n === undefined ? undefined : formatIp(n));

export function servicesToJson(s: ServerServices): ServicesJson {
  return {
    dhcp: {
      enabled: s.dhcp.enabled,
      pools: s.dhcp.pools.map((p) => ({
        name: p.name, start: formatIp(p.start), prefix: p.prefix, maxUsers: p.maxUsers, gateway: ip(p.gateway), dns: ip(p.dns),
        domain: p.domain, tftp: ip(p.tftp), leaseMinutes: p.leaseMinutes,
        reservations: p.reservations.map((r) => ({ ip: formatIp(r.ip), mac: r.mac, clientId: r.clientId, name: r.name })),
        identifyBy: p.identifyBy,
      })),
    },
    dns: { enabled: s.dns.enabled, origin: s.dns.origin, records: [...s.dns.records] },
    http: { enabled: s.http.enabled, files: [...s.http.files] },
    mail: s.mail,
    ssh: s.ssh,
    webapps: s.webapps,
  };
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function arr(v: unknown, what: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ITEMS) throw new Error(`Lista no válida: ${what}.`);
  return v;
}

function str(v: unknown, what: string, max = 253): string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`Texto no válido: ${what}.`);
  return v;
}

function bool(v: unknown): boolean {
  return v === true;
}

function optIp(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseIp(str(v, what));
  if (n === null) throw new Error(`Dirección IP no válida en ${what}.`);
  return n;
}

function num(v: unknown, what: string, min: number, max: number, dflt?: number): number {
  if (v === undefined && dflt !== undefined) return dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`Número no válido: ${what}.`);
  return v;
}

function pool(v: unknown): PtDhcpPool {
  if (!isObj(v)) throw new Error('Pool DHCP no válido.');
  const start = optIp(v.start, 'pool DHCP');
  if (start === undefined) throw new Error('Pool DHCP sin IP inicial.');
  return {
    name: str(v.name, 'nombre de pool', 32), start, prefix: num(v.prefix, 'máscara de pool', 8, 30), maxUsers: num(v.maxUsers, 'usuarios del pool', 1, 65_534),
    gateway: optIp(v.gateway, 'puerta de enlace'), dns: optIp(v.dns, 'DNS del pool'), domain: v.domain === undefined ? undefined : str(v.domain, 'dominio'),
    tftp: optIp(v.tftp, 'TFTP'), leaseMinutes: num(v.leaseMinutes, 'concesión', 1, 525_600, DEFAULT_LEASE_MINUTES),
    reservations: arr(v.reservations, 'reservas').map(reservation),
    identifyBy: v.identifyBy === undefined ? undefined : identifyBy(v.identifyBy),
  };
}

function identifyBy(v: unknown): 'mac' | 'client-id' {
  if (v === 'mac' || v === 'client-id') return v;
  throw new Error('Identificación de concesiones no válida (mac o client-id).');
}

const MAX_CLIENT_ID_HEX = 510;

function reservation(r: unknown): PtDhcpPool['reservations'][number] {
  if (!isObj(r)) throw new Error('Reserva no válida.');
  const rip = optIp(r.ip, 'reserva');
  const name = r.name === undefined ? undefined : str(r.name, 'nombre de reserva', 64);
  if (rip === undefined) throw new Error('Reserva DHCP incompleta.');
  if (r.clientId !== undefined) {
    const id = parseHexId(str(r.clientId, 'Client-ID', MAX_CLIENT_ID_HEX));
    if (!id) throw new Error('Client-ID de reserva no válido (hexadecimal).');
    return { ip: rip, clientId: id, name };
  }
  const mac = parseMac(str(r.mac, 'MAC'));
  if (!mac) throw new Error('Reserva DHCP incompleta.');
  return { ip: rip, mac, name };
}

function origin(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const o = str(v, 'origen de zona', 253);
  if (validateOrigin(o)) throw new Error('Origen de zona DNS no válido.');
  return cleanOrigin(o);
}

function record(v: unknown): DnsRecord {
  if (!isObj(v) || !RECORD_TYPES.has(String(v.type))) throw new Error('Registro DNS no válido.');
  return { name: str(v.name, 'nombre DNS'), type: v.type as DnsRecord['type'], value: str(v.value, 'valor DNS', 1024), priority: v.priority === undefined ? undefined : num(v.priority, 'prioridad MX', 0, 65_535), ttl: num(v.ttl, 'TTL', 0, 2_147_483_647, DEFAULT_TTL) };
}

function account(v: unknown): Account {
  if (!isObj(v)) throw new Error('Cuenta no válida.');
  return { name: str(v.name, 'usuario', 64), password: str(v.password, 'contraseña', 128) };
}

function access(v: unknown, dflt: WebAppAccess, other?: WebAppAccess): WebAppAccess {
  if (!isObj(v)) return dflt;
  const a = {
    enabled: bool(v.enabled), mode: v.mode === 'port' ? 'port' as const : 'alias' as const,
    alias: v.alias === undefined ? dflt.alias : str(v.alias, 'alias web', 64), port: num(v.port, 'puerto web', 1, 65_535, dflt.port),
  };
  const err = validateAccess(a, other);
  if (err) throw new Error(err);
  return a;
}

function webapps(v: unknown): WebApps {
  const d = defaultWebApps();
  if (!isObj(v)) return d;
  const admin = isObj(v.admin) ? v.admin : {};
  const roundcube = access(v.roundcube, d.roundcube);
  return {
    roundcube,
    admin: { ...access(v.admin, d.admin, roundcube), user: admin.user === undefined ? d.admin.user : str(admin.user, 'usuario de gestión web', 32), password: admin.password === undefined ? d.admin.password : str(admin.password, 'contraseña de gestión web', 128) },
  };
}

export function servicesFromJson(v: unknown): ServerServices {
  if (v === undefined) return defaultServices();
  if (!isObj(v)) throw new Error('Servicios del servidor no válidos.');
  const d = isObj(v.dhcp) ? v.dhcp : {};
  const n = isObj(v.dns) ? v.dns : {};
  const h = isObj(v.http) ? v.http : {};
  const m = isObj(v.mail) ? v.mail : {};
  const s = isObj(v.ssh) ? v.ssh : {};
  return {
    dhcp: { enabled: bool(d.enabled), pools: arr(d.pools, 'pools').map(pool) },
    dns: { enabled: bool(n.enabled), origin: origin(n.origin), records: arr(n.records, 'registros').map(record) },
    http: { enabled: bool(h.enabled), files: arr(h.files, 'ficheros web').map((f) => { if (!isObj(f)) throw new Error('Fichero web no válido.'); return { name: str(f.name, 'fichero web', 128), content: str(f.content, 'contenido web', MAX_TEXT) }; }) },
    mail: { smtp: bool(m.smtp), pop3: bool(m.pop3), imap: bool(m.imap), domain: m.domain === undefined ? '' : str(m.domain, 'dominio de correo'), users: arr(m.users, 'usuarios de correo').map(account) },
    ssh: { enabled: bool(s.enabled), users: arr(s.users, 'usuarios SSH').map(account) },
    webapps: webapps(v.webapps),
  };
}

export function mailboxesFromJson(v: unknown): Record<string, MailMessage[]> {
  if (v === undefined) return {};
  if (!isObj(v)) throw new Error('Buzones no válidos.');
  const out: Record<string, MailMessage[]> = {};
  for (const [user, list] of Object.entries(v)) {
    out[user] = arr(list, 'buzón').map((mm) => {
      if (!isObj(mm)) throw new Error('Mensaje no válido.');
      return { from: str(mm.from, 'remitente'), to: arr(mm.to, 'destinatarios').map((t) => str(t, 'destinatario')), subject: str(mm.subject, 'asunto', 998), body: str(mm.body, 'cuerpo', MAX_TEXT), date: num(mm.date, 'fecha', 0, Number.MAX_SAFE_INTEGER) };
    });
  }
  return out;
}
