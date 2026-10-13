/** Recursion settings of bind9 as the GUI and the web management edit them (validated in one place). */
import type { DnsSettings } from './config.ts';
import { parseIp, formatIp } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

export const MAX_FORWARDERS = 8;
export const GOOGLE_FORWARDERS = '8.8.8.8, 8.8.4.4';

export interface RecursionInput {
  readonly forwarders: string;
  readonly forwardOnly: boolean;
  readonly allowRecursion: 'localnets' | 'any';
}

export function forwardersText(s: DnsSettings): string {
  return (s.forwarders ?? []).map(formatIp).join(', ');
}

/** New DNS settings, or a translated error. */
export function applyRecursion(s: DnsSettings, input: RecursionInput): DnsSettings | { error: string } {
  const items = input.forwarders.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  if (items.length > MAX_FORWARDERS) return { error: t('dns.err.many', { max: MAX_FORWARDERS }) };
  const forwarders: number[] = [];
  for (const item of items) {
    const ip = parseIp(item);
    if (ip === null) return { error: t('dns.err.ip', { value: item }) };
    if (!forwarders.includes(ip)) forwarders.push(ip);
  }
  return { ...s, forwarders, forwardOnly: input.forwardOnly, allowRecursion: input.allowRecursion };
}
