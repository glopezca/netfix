/** Server-PT service configuration (immutable records, edited from the GUI or restored from JSON). */

export interface DhcpReservation {
  readonly ip: number;
  readonly mac: string;
  readonly name?: string;
}

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

export interface ServerServices {
  readonly dhcp: { readonly enabled: boolean; readonly pools: readonly PtDhcpPool[] };
  readonly dns: { readonly enabled: boolean; readonly records: readonly DnsRecord[] };
  readonly http: { readonly enabled: boolean; readonly files: readonly WebFile[] };
  readonly mail: {
    readonly smtp: boolean;
    readonly pop3: boolean;
    readonly imap: boolean;
    readonly domain: string;
    readonly users: readonly Account[];
  };
  readonly ssh: { readonly enabled: boolean; readonly users: readonly Account[] };
}

export const DEFAULT_LEASE_MINUTES = 1440;
export const DEFAULT_TTL = 86400;
export const DEFAULT_MAX_USERS = 50;

export const DEFAULT_INDEX = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Server-PT</title></head>
<body>
<h1>Servidor web de netsim</h1>
<p>Esta página la sirve el servicio HTTP de un Server-PT.</p>
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
  };
}
