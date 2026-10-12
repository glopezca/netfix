/** Form actions of the Server-PT management GUI: each one validates and applies to the live server. */
import type { Server } from '../devices/server.ts';
import { validHostname } from '../devices/host.ts';
import { parseIp, parseMask } from '../core/ip.ts';
import { validatePool } from '../services/dhcp-pt.ts';
import { validateRecord } from '../services/dns-service.ts';
import { validateOrigin, cleanOrigin } from '../services/dns-names.ts';
import { validateAccess, DEFAULT_LEASE_MINUTES, DEFAULT_TTL } from '../services/config.ts';
import type { Account, DnsRecord, ServerServices, WebAppAccess } from '../services/config.ts';

export type Fields = ReadonlyMap<string, string>;
export interface Outcome {
  readonly ok?: string;
  readonly error?: string;
}

const SAVED: Outcome = { ok: 'Los cambios se han guardado correctamente.' };
const on = (f: Fields, k: string): boolean => f.has(k);
const optIp = (t: string | undefined): number | undefined | null => (t?.trim() ? parseIp(t.trim()) : undefined);

function set(server: Server, change: (s: ServerServices) => ServerServices): Outcome {
  server.setServices(change(server.services));
  return SAVED;
}

function setup(server: Server, f: Fields): Outcome {
  const name = (f.get('hostname') ?? '').trim();
  const bad = validHostname(name);
  if (bad) return { error: bad };
  if (f.get('mode') === 'dhcp') {
    if (server.config.mode !== 'dhcp') server.useDhcp();
  } else {
    const ip = optIp(f.get('ip'));
    const prefix = parseMask((f.get('mask') ?? '').trim());
    const gateway = optIp(f.get('gateway'));
    const dns = optIp(f.get('dns'));
    if (ip === null || ip === undefined || prefix === null || gateway === null || dns === null) return { error: 'Revisa la dirección IP, la máscara, la puerta de enlace y el DNS.' };
    server.setStatic({ ip, prefix, gateway, dns });
  }
  server.setHostname(name);
  return SAVED;
}

function addPool(server: Server, f: Fields): Outcome {
  const start = optIp(f.get('start'));
  const prefix = parseMask((f.get('mask') ?? '').trim());
  const gateway = optIp(f.get('gateway'));
  const dns = optIp(f.get('dns'));
  const max = Number(f.get('max'));
  if (!start || prefix === null || gateway === null || dns === null || !Number.isInteger(max)) return { error: 'Revisa la IP inicial, la máscara, los usuarios, la puerta de enlace y el DNS.' };
  const pool = { name: (f.get('name') ?? '').trim(), start, prefix, maxUsers: max, gateway, dns, domain: (f.get('domain') ?? '').trim() || undefined, leaseMinutes: DEFAULT_LEASE_MINUTES, reservations: [] };
  const err = validatePool(pool, server.services.dhcp.pools);
  return err ? { error: err } : set(server, (s) => ({ ...s, dhcp: { ...s.dhcp, pools: [...s.dhcp.pools, pool] } }));
}

function addRecord(server: Server, f: Fields): Outcome {
  const type = (f.get('type') ?? 'A') as DnsRecord['type'];
  const r: DnsRecord = { name: (f.get('name') ?? '').trim(), type, value: (f.get('value') ?? '').trim(), ttl: DEFAULT_TTL, priority: type === 'MX' ? Number(f.get('priority') ?? 10) : undefined };
  const err = ['A', 'CNAME', 'MX', 'NS', 'TXT'].includes(type) ? validateRecord(r, server.services.dns.origin) : 'Tipo de registro no válido.';
  return err ? { error: err } : set(server, (s) => ({ ...s, dns: { ...s.dns, records: [...s.dns.records, r] } }));
}

function dns(server: Server, f: Fields): Outcome {
  const origin = (f.get('origin') ?? '').trim();
  const err = validateOrigin(origin);
  return err ? { error: err } : set(server, (s) => ({ ...s, dns: { ...s.dns, enabled: on(f, 'enabled'), origin: cleanOrigin(origin) } }));
}

function access(f: Fields, prefix: string, current: WebAppAccess, enabled: boolean): WebAppAccess {
  return { enabled, mode: f.get(`${prefix}mode`) === 'port' ? 'port' : 'alias', alias: (f.get(`${prefix}alias`) ?? current.alias).trim(), port: Number(f.get(`${prefix}port`) ?? current.port) };
}

function web(server: Server, f: Fields): Outcome {
  const rc = access(f, 'rc_', server.services.webapps.roundcube, on(f, 'rc_enabled'));
  const err = validateAccess(rc, server.services.webapps.admin);
  if (err) return { error: err };
  server.setUnit('http', on(f, 'http'));
  return set(server, (s) => ({ ...s, webapps: { ...s.webapps, roundcube: rc } }));
}

function users(server: Server, which: 'mail' | 'ssh', f: Fields, add: boolean): Outcome {
  const list: readonly Account[] = server.services[which].users;
  const name = (f.get(add ? 'name' : 'key') ?? '').trim();
  let next: Account[];
  if (add) {
    if (!/^[a-z0-9._-]{1,32}$/i.test(name)) return { error: 'Usuario: letras, números, punto, guion o guion bajo.' };
    if (!f.get('password')) return { error: 'Escribe una contraseña.' };
    if (list.some((u) => u.name === name)) return { error: `Ya existe ${name}.` };
    next = [...list, { name, password: f.get('password') ?? '' }];
  } else next = list.filter((u) => u.name !== name);
  return set(server, (s) => (which === 'mail' ? { ...s, mail: { ...s.mail, users: next } } : { ...s, ssh: { ...s.ssh, users: next } }));
}

function admin(server: Server, f: Fields): Outcome & { readonly moved?: boolean } {
  const cur = server.services.webapps.admin;
  const next = { ...access(f, '', cur, true), user: (f.get('user') ?? '').trim() || cur.user, password: f.get('password') || cur.password };
  const err = validateAccess(next, server.services.webapps.roundcube);
  if (err) return { error: err };
  set(server, (s) => ({ ...s, webapps: { ...s.webapps, admin: next } }));
  return { ...SAVED, moved: next.mode !== cur.mode || next.port !== cur.port || next.alias !== cur.alias };
}

/** Runs a form action of a page. */
export function runAction(server: Server, pageId: string, f: Fields): Outcome & { readonly moved?: boolean } {
  const action = f.get('action') ?? '';
  switch (action) {
    case 'setup': return setup(server, f);
    case 'dhcp': return set(server, (s) => ({ ...s, dhcp: { ...s.dhcp, enabled: on(f, 'enabled') } }));
    case 'pool-add': return addPool(server, f);
    case 'pool-del': return set(server, (s) => ({ ...s, dhcp: { ...s.dhcp, pools: s.dhcp.pools.filter((p) => p.name !== f.get('key')) } }));
    case 'dns': return dns(server, f);
    case 'record-add': return addRecord(server, f);
    case 'record-del': return set(server, (s) => ({ ...s, dns: { ...s.dns, records: s.dns.records.filter((_, i) => String(i) !== f.get('key')) } }));
    case 'web': return web(server, f);
    case 'mail': return set(server, (s) => ({ ...s, mail: { ...s.mail, smtp: on(f, 'smtp'), pop3: on(f, 'pop3'), imap: on(f, 'imap'), domain: (f.get('domain') ?? '').trim().toLowerCase() } }));
    case 'ssh': return set(server, (s) => ({ ...s, ssh: { ...s.ssh, enabled: on(f, 'enabled') } }));
    case 'user-add': case 'user-del': return users(server, pageId === 'ssh' ? 'ssh' : 'mail', f, action === 'user-add');
    case 'admin': return admin(server, f);
    default: return { error: 'Acción desconocida.' };
  }
}
