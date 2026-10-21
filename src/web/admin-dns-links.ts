/** Links and hidden fields that keep the DNS page on the same mode tab, zone and file. */
import { h } from './html.ts';
import type { Markup } from './html.ts';
import { DNS_MODES } from '../services/dns-edit.ts';
import type { DnsMode } from '../services/dns-edit.ts';

export type Query = ReadonlyMap<string, string>;

/** Link inside the DNS page keeping the chosen mode, zone and file. */
export function dnsLink(base: string, params: Readonly<Record<string, string | undefined>>): string {
  const extra = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `&${k}=${encodeURIComponent(v ?? '')}`).join('');
  return `${base}/?page=dns${extra}`;
}

export const modeOf = (q: Query): DnsMode => DNS_MODES.find((m) => m === q.get('mode')) ?? 'authoritative';

/** Hidden field that brings the form back to the same mode tab. */
export const keepMode = (mode: DnsMode): Markup => h('input', { type: 'hidden', name: 'mode', value: mode });

