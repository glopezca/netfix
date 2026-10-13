/** English (UK): bind9 recursion and forwarders (GUI and web management). */
import type { DnsKey } from '../es-ES/dns.ts';

export const DNS_EN: Readonly<Record<DnsKey, string>> = {
  'dns.rec.title': 'Query forwarding (recursion)',
  'dns.rec.help': 'With forwarders, the server also resolves Internet names: it asks those servers (for example 8.8.8.8 and 8.8.4.4 through the ISP cloud), caches the answer and replies to its clients. Without forwarders it only answers from its zones (REFUSED for the rest).',
  'dns.rec.forwarders': 'Forwarders',
  'dns.rec.forwardersHint': 'IPv4 addresses separated by commas. Empty = no recursion.',
  'dns.rec.mode': 'Mode',
  'dns.rec.only': 'forward only (forwarders only)',
  'dns.rec.first': 'forward first (forwarders, then the Internet)',
  'dns.rec.allow': 'Clients allowed to recurse (allow-recursion)',
  'dns.rec.localnets': 'Local network (localnets)',
  'dns.rec.any': 'Anyone (any: open resolver, not recommended)',
  'dns.rec.save': 'Apply',
  'dns.rec.google': 'Use Google (8.8.8.8, 8.8.4.4)',
  'dns.rec.flush': 'Flush cache (rndc flush)',
  'dns.rec.cache': 'Cached entries: {count}',
  'dns.rec.saved': 'Saved. Also applied to /etc/bind/named.conf.options.',
  'dns.rec.flushed': 'Cache flushed.',
  'dns.relay': 'ISP DNS (relay)',
  'dns.relayHint': 'The line’s DHCP hands out the router’s IP as DNS and the router relays queries to 8.8.8.8 and 8.8.4.4 (with a cache), like a home router.',
  'dns.relayOn': 'DNS: {ip} (ISP relay to 8.8.8.8 and 8.8.4.4).',
  'dns.err.ip': '“{value}” is not an IPv4 address.',
  'dns.err.many': 'At most {max} forwarders.',
};
