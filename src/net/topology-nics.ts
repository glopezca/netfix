/** Topology file records for the extra NICs of a host (Linux router) and its static routes. */
import type { Host } from '../devices/host.ts';
import { MAX_STATIC_ROUTES, routeTo } from '../devices/host-nics.ts';
import type { StaticRoute } from '../devices/host-nics.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export interface NicRecord {
  readonly port: string;
  readonly ip?: string;
  readonly prefix?: number;
  readonly down?: boolean;
}

export interface RouteRecord {
  readonly to: string;
  readonly via: string;
}

/** The NICs after the first one (the first is the host's `mode/ip/mask/gateway`). */
export function nicsToJson(host: Host): NicRecord[] | undefined {
  const extra = host.nics().slice(1).map((n): NicRecord => ({
    port: n.port,
    ...(n.ip !== undefined && n.prefix !== undefined ? { ip: formatIp(n.ip), prefix: n.prefix } : {}),
    ...(n.adminUp ? {} : { down: true }),
  }));
  return extra.some((n) => n.ip !== undefined || n.down) ? extra : undefined;
}

export function routesToJson(routes: readonly StaticRoute[]): RouteRecord[] | undefined {
  return routes.length ? routes.map((r) => ({ to: `${formatIp(r.net)}/${r.prefix}`, via: formatIp(r.via) })) : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Applies saved NICs; entries for unknown ports or with invalid addresses are ignored. */
export function restoreNics(host: Host, value: unknown): void {
  if (!Array.isArray(value)) return;
  const ports = host.portNames().slice(1);
  for (const v of value.slice(0, ports.length)) {
    if (!isObj(v) || typeof v.port !== 'string' || !ports.includes(v.port)) continue;
    const ip = typeof v.ip === 'string' ? parseIp(v.ip) : null;
    const prefix = typeof v.prefix === 'number' && Number.isInteger(v.prefix) && v.prefix >= 0 && v.prefix <= 32 ? v.prefix : null;
    if (ip !== null && prefix !== null) host.setNicAddress(v.port, { ip, prefix });
    if (v.down === true) host.setNicUp(v.port, false);
  }
}

export function restoreRoutes(host: Host, value: unknown): void {
  if (!Array.isArray(value)) return;
  const routes: StaticRoute[] = [];
  for (const v of value.slice(0, MAX_STATIC_ROUTES)) {
    if (!isObj(v) || typeof v.to !== 'string' || typeof v.via !== 'string') continue;
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(v.to);
    const net = m ? parseIp(m[1] ?? '') : null;
    const prefix = Number(m?.[2]);
    const via = parseIp(v.via);
    if (net !== null && via !== null && prefix <= 32) routes.push(routeTo(net, prefix, via));
  }
  if (routes.length) host.setStaticRoutes(routes);
}
