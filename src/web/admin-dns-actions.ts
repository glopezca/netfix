/** Form actions of the DNS page (modes, cache, forwarding, recursion, zones and records), via services/dns-edit.ts. */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import type { DnsRecord, DnsSettings } from '../services/config.ts';
import { DEFAULT_TTL } from '../services/config.ts';
import {
  DNS_MODES, addRecord, addZone, dnsModes, removeRecord, removeZone, setAuthoritative, setCache, setForwarders, setIterative, setRecursion,
  setZoneNs, ymdOf,
} from '../services/dns-edit.ts';
import type { DnsMode, Edited } from '../services/dns-edit.ts';
import { GOOGLE_FORWARDERS, forwardersText } from '../services/dns-recursion.ts';
import { draftFrom } from './admin-dns-zones.ts';

type Fields = ReadonlyMap<string, string>;
export interface DnsOutcome {
  readonly ok?: string;
  readonly error?: string;
  /** Query to come back to (mode tab and zone). */
  readonly next?: string;
}

const MAX_RECORD_TTL = 2_147_483_647;

/** Chains edits; the first error stops. */
function chain(s: DnsSettings, ...steps: ((x: DnsSettings) => Edited)[]): Edited {
  let cur: Edited = s;
  for (const step of steps) {
    if ('error' in cur) return cur;
    cur = step(cur);
  }
  return cur;
}

/** The mode cards: one form with a switch per mode (a locked iterative switch is not sent and not changed). */
function modes(server: Server, f: Fields): Edited {
  const on = (m: DnsMode): boolean => f.has(m);
  server.setUnit('dns', f.has('enabled'));
  const s = server.services.dns;
  return chain(s,
    (x) => setRecursion(x, on('recursive'), x.allowRecursion ?? 'localnets'),
    (x) => (on('forwarder') === dnsModes(x).forwarder.on ? x : setForwarders(x, on('forwarder') ? GOOGLE_FORWARDERS : '')),
    (x) => (on('cache') === dnsModes(x).cache.on ? x : setCache(x, on('cache'))),
    (x) => setAuthoritative(x, on('authoritative')),
    (x) => (dnsModes(x).iterative.locked || on('iterative') === dnsModes(x).iterative.on ? x : setIterative(x, on('iterative'))));
}

function record(f: Fields): DnsRecord {
  const type = (f.get('type') ?? 'A') as DnsRecord['type'];
  const ttl = Number(f.get('ttl') ?? DEFAULT_TTL);
  return {
    name: (f.get('name') ?? '').trim().toLowerCase(), type, value: (f.get('value') ?? '').trim(),
    ttl: Number.isInteger(ttl) && ttl >= 0 && ttl <= MAX_RECORD_TTL ? ttl : DEFAULT_TTL,
    ...(type === 'MX' ? { priority: Number(f.get('priority') ?? 10) } : {}),
  };
}

function edit(server: Server, f: Fields, action: string): Edited | undefined {
  const s = server.services.dns;
  const zone = (f.get('zone') ?? '').trim();
  const day = ymdOf(server.clock.now());
  switch (action) {
    case 'dns-modes': return modes(server, f);
    case 'dns-cache': return setCache(s, (f.get('ttl') ?? '').trim() !== '0', f.get('ttl'));
    case 'dns-forwarders': return setForwarders(s, f.get('forwarders') ?? '');
    case 'dns-iterative': return setIterative(s, f.get('forward') === 'first');
    case 'dns-recursive': return setRecursion(s, f.has('recursion'), f.get('allow') === 'any' ? 'any' : 'localnets');
    case 'zone-add': return addZone(s, draftFrom(f), day);
    case 'zone-del': return removeZone(s, zone);
    case 'zone-ns': return setZoneNs(s, zone, f.get('ns') ?? '', day);
    case 'zone-record-add': return addRecord(s, zone, record(f), day);
    case 'zone-record-del': return removeRecord(s, zone, Number(f.get('key')), day);
    default: return undefined;
  }
}

/** Where to come back: the same mode tab and, for zone edits, the zone (not a deleted one). */
function nextOf(server: Server, f: Fields, action: string): string {
  const mode = DNS_MODES.find((m) => m === f.get('mode')) ?? 'authoritative';
  const zone = action === 'zone-add' ? server.services.dns.zones[server.services.dns.zones.length - 1]?.name : f.get('zone');
  const keepZone = zone && action !== 'zone-del' && server.services.dns.zones.some((z) => z.name === zone);
  return `&mode=${mode}${keepZone ? `&zone=${encodeURIComponent(zone)}` : ''}`;
}

/** Runs a DNS action; undefined when the action is not one of the DNS page. */
export function dnsAction(server: Server, f: Fields): DnsOutcome | undefined {
  const action = f.get('action') ?? '';
  if (action === 'dns-flush') {
    server.dns.forwarder.flush();
    return { ok: t('wad.flushed'), next: '&mode=cache' };
  }
  const before = forwardersText(server.services.dns);
  const next = edit(server, f, action);
  if (next === undefined) return undefined;
  if ('error' in next) return { error: next.error };
  server.setServices({ ...server.services, dns: next });
  if (action.startsWith('dns-') || forwardersText(next) !== before) server.dns.forwarder.flush();
  return { ok: t('wa.saved'), next: nextOf(server, f, action) };
}
