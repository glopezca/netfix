/** Server service configuration (immutable records, edited from the GUI or restored from JSON). */

/** A reservation identifies the client by MAC (Kea `hw-address`) or by client-id (option 61). */
export interface DhcpReservation {
  readonly ip: number;
  readonly mac?: string;
  /** Lowercase hex, e.g. "01" + MAC for PCs or the hex of an ASCII identifier. */
  readonly clientId?: string;
  readonly name?: string;
}

/** How automatic leases recognise a returning client (Kea `match-client-id`). */
export type LeaseIdentity = 'client-id' | 'mac';

/** A Packet Tracer-style pool: start address + maximum users inside one subnet. */
export interface PtDhcpPool {
  readonly name: string;
  readonly start: number;
  readonly prefix: number;
  readonly maxUsers: number;
  readonly gateway?: number;
  readonly dns?: number;
  readonly domain?: string;
  readonly tftp?: number;
  readonly leaseMinutes: number;
  readonly reservations: readonly DhcpReservation[];
  /** Undefined = client-id (Kea default): option 61 when present, the MAC otherwise. */
  readonly identifyBy?: LeaseIdentity;
}

export type DnsRecordType = 'A' | 'CNAME' | 'MX' | 'NS' | 'TXT';

export interface DnsRecord {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly value: string;
  readonly priority?: number;
  readonly ttl: number;
}

export interface WebFile {
  readonly name: string;
  readonly content: string;
}

export interface Account {
  readonly name: string;
  readonly password: string;
}

/** How a web application is reached: a URL alias on Apache's ports, or a port of its own. */
export interface WebAppAccess {
  readonly enabled: boolean;
  readonly mode: 'alias' | 'port';
  /** "/roundcube" */
  readonly alias: string;
  readonly port: number;
}

export interface WebApps {
  /** Roundcube webmail (needs Apache: alias on its ports or a VirtualHost on its own port). */
  readonly roundcube: WebAppAccess;
  /** Web management of the server (WRT300N style), with its own login. */
  readonly admin: WebAppAccess & { readonly user: string; readonly password: string };
}

export const RESERVED_PORTS: readonly number[] = [22, 25, 53, 67, 110, 143];

export function defaultWebApps(): WebApps {
  return {
    roundcube: { enabled: false, mode: 'alias', alias: '/roundcube', port: 8080 },
    admin: { enabled: false, mode: 'port', alias: '/admin', port: 10000, user: 'admin', password: 'admin' },
  };
}

/** Error message for an alias or port, or null. */
export function validateAccess(a: WebAppAccess, other?: WebAppAccess): string | null {
  if (!/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(a.alias)) return 'El alias debe empezar por / y contener solo letras, números, punto, guion o guion bajo (por ejemplo /roundcube).';
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) return 'El puerto va de 1 a 65535.';
  if (a.mode === 'port' && RESERVED_PORTS.includes(a.port)) return `El puerto ${a.port} lo usa otro servicio del servidor.`;
  if (other?.enabled && a.enabled && a.mode === 'port' && other.mode === 'port' && other.port === a.port) return `El puerto ${a.port} ya lo usa la otra aplicación web.`;
  if (other?.enabled && a.enabled && a.mode === 'alias' && other.mode === 'alias' && other.alias === a.alias) return `El alias ${a.alias} ya lo usa la otra aplicación web.`;
  return null;
}

/** bind9: zones, plus recursion through forwarders (none = authoritative only, like v0.6). */
export interface DnsSettings {
  readonly enabled: boolean;
  readonly origin?: string;
  readonly records: readonly DnsRecord[];
  /** Upstream resolvers (forwarders { … }); empty or absent = no recursion. */
  readonly forwarders?: readonly number[];
  /** forward only (true, default) or forward first. */
  readonly forwardOnly?: boolean;
  /** allow-recursion: localnets (default) or any. */
  readonly allowRecursion?: 'localnets' | 'any';
}

export interface ServerServices {
  readonly dhcp: { readonly enabled: boolean; readonly pools: readonly PtDhcpPool[] };
  /** `origin`: zone origin for relative names (BIND `$ORIGIN`); undefined = every name is absolute. */
  readonly dns: DnsSettings;
  readonly http: { readonly enabled: boolean; readonly files: readonly WebFile[] };
  readonly mail: {
    readonly smtp: boolean;
    readonly pop3: boolean;
    readonly imap: boolean;
    readonly domain: string;
    readonly users: readonly Account[];
  };
  readonly ssh: { readonly enabled: boolean; readonly users: readonly Account[] };
  /** nftables.service: loads /etc/nftables.conf at boot and on start/restart/reload. */
  readonly firewall: { readonly enabled: boolean };
  readonly webapps: WebApps;
}

export const DEFAULT_LEASE_MINUTES = 1440;
export const DEFAULT_TTL = 86400;
export const DEFAULT_MAX_USERS = 50;

export const DEFAULT_INDEX = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Server</title></head>
<body>
<p><span class="web-brand-logo">Netfix</span></p>
<h1>Servidor web de Netfix</h1>
<p>Esta página la sirve el servicio HTTP de un servidor de Netfix.</p>
<p>Edita <code>index.html</code> en la pestaña Servicios → HTTP, o crea páginas nuevas.</p>
<p><a href="ayuda.html">Ayuda</a></p>
</body>
</html>`;

export const DEFAULT_HELP = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Ayuda</title></head>
<body>
<h1>Ayuda</h1>
<p>Prueba desde un PC: navegador, <code>curl http://IP/</code> o <code>wget</code>.</p>
<p><a href="index.html">Volver</a></p>
</body>
</html>`;

export function defaultServices(): ServerServices {
  return {
    dhcp: { enabled: false, pools: [] },
    dns: { enabled: false, records: [] },
    http: { enabled: true, files: [{ name: 'index.html', content: DEFAULT_INDEX }, { name: 'ayuda.html', content: DEFAULT_HELP }] },
    mail: { smtp: false, pop3: false, imap: false, domain: '', users: [] },
    ssh: { enabled: false, users: [] },
    firewall: { enabled: false },
    webapps: defaultWebApps(),
  };
}
