/** English (UK): bind9 recursion and forwarders (GUI and web management). */
import type { DnsKey } from '../es-ES/dns.ts';

export const DNS_EN: Readonly<Record<DnsKey, string>> = {
  'dns.rec.localnets': 'Local network (localnets)',
  'dns.rec.any': 'Anyone (any: open resolver, not recommended)',
  'dns.relay': 'ISP DNS (relay)',
  'dns.relayHint': 'The line’s DHCP hands out the router’s IP as DNS and the router relays queries to 8.8.8.8 and 8.8.4.4 (with a cache), like a home router.',
  'dns.relayOn': 'DNS: {ip} (ISP relay to 8.8.8.8 and 8.8.4.4).',
  'dns.err.ip': '“{value}” is not an IPv4 address.',
  'dns.err.many': 'At most {max} forwarders.',
};
