/**
 * Public zones of the emulated Internet (google.com, example.com…) with the name server that is authoritative for
 * each, used by Google's resolvers and by the root → TLD → authoritative hierarchy of iterative resolution.
 */
import type { DnsMessage } from './packets.ts';
import type { DnsRecord } from '../services/config.ts';
import { answerQuery } from '../services/dns-service.ts';
import { normalizeName } from './dns.ts';

const RECORD_TTL = 300;

export const A = (name: string, value: string): DnsRecord => ({ name, type: 'A', value, ttl: RECORD_TTL });
const CNAME = (name: string, value: string): DnsRecord => ({ name, type: 'CNAME', value, ttl: RECORD_TTL });
const MX = (name: string, value: string, priority: number): DnsRecord => ({ name, type: 'MX', value, priority, ttl: RECORD_TTL });
const TXT = (name: string, value: string): DnsRecord => ({ name, type: 'TXT', value, ttl: RECORD_TTL });

/** Built-in public zones (origin → records) that Google's emulated resolvers answer. */
export interface PublicZone {
  readonly origin: string;
  readonly records: readonly DnsRecord[];
  /** Authoritative name server (name and address) the TLD refers to. */
  readonly ns?: { readonly name: string; readonly ip: string };
}

export const ZONES: readonly PublicZone[] = [
  { origin: 'google.com', records: [A('google.com', '142.250.184.4'), A('www.google.com', '142.250.184.4'), MX('google.com', 'smtp.google.com', 10), A('smtp.google.com', '142.250.153.27'), TXT('google.com', 'v=spf1 include:_spf.google.com ~all')], ns: { name: 'ns1.google.com', ip: '216.239.32.10' } },
  { origin: 'dns.google', records: [A('dns.google', '8.8.8.8'), A('dns.google', '8.8.4.4')], ns: { name: 'ns1.zdns.google', ip: '216.239.32.114' } },
  // Reverse lookups (dig -x 8.8.8.8) are derived from the A records.
  { origin: 'in-addr.arpa', records: [A('dns.google', '8.8.8.8'), A('dns.google', '8.8.4.4')] },
  { origin: 'example.com', records: [A('example.com', '93.184.215.14'), A('www.example.com', '93.184.215.14')], ns: { name: 'a.iana-servers.net', ip: '199.43.135.53' } },
  { origin: 'ifconfig.me', records: [A('ifconfig.me', '34.160.111.145')], ns: { name: 'ns-cloud-a1.googledomains.com', ip: '216.239.32.106' } },
  { origin: 'wikipedia.org', records: [A('wikipedia.org', '185.15.58.224'), CNAME('www.wikipedia.org', 'dyna.wikimedia.org'), CNAME('es.wikipedia.org', 'dyna.wikimedia.org')], ns: { name: 'ns0.wikimedia.org', ip: '208.80.154.238' } },
  { origin: 'wikimedia.org', records: [A('dyna.wikimedia.org', '185.15.58.224')], ns: { name: 'ns0.wikimedia.org', ip: '208.80.154.238' } },
  { origin: 'github.com', records: [A('github.com', '140.82.121.4'), CNAME('www.github.com', 'github.com')], ns: { name: 'dns1.p08.nsone.net', ip: '198.51.44.8' } },
  { origin: 'ubuntu.com', records: [A('ubuntu.com', '185.125.190.20'), A('www.ubuntu.com', '185.125.190.20'), A('archive.ubuntu.com', '185.125.190.81'), A('security.ubuntu.com', '185.125.190.82')], ns: { name: 'ns1.canonical.com', ip: '91.189.95.3' } },
  { origin: 'debian.org', records: [A('debian.org', '151.101.2.132'), A('www.debian.org', '151.101.2.132'), A('deb.debian.org', '151.101.2.132')], ns: { name: 'nsp.dnsnode.net', ip: '194.58.198.32' } },
  { origin: 'cisco.com', records: [A('cisco.com', '72.163.4.185'), A('www.cisco.com', '23.212.248.9')], ns: { name: 'ns1.cisco.com', ip: '72.163.5.201' } },
  { origin: 'paypal.me', records: [A('paypal.me', '151.101.1.21')], ns: { name: 'ns1.p57.dynect.net', ip: '208.78.70.57' } },
  { origin: 'pool.ntp.org', records: [A('pool.ntp.org', '162.159.200.1'), A('es.pool.ntp.org', '162.159.200.123')], ns: { name: 'a.ntpns.org', ip: '185.172.155.53' } },
];

export function inZone(qname: string, origin: string): boolean {
  return qname === origin || qname.endsWith(`.${origin}`);
}

const MAX_CNAME_CHAIN = 8;

/** A recursive resolver follows a CNAME into other zones (es.wikipedia.org → dyna.wikimedia.org → A). */
export function chase(q: DnsMessage, first: DnsMessage): DnsMessage {
  let msg = first;
  for (let i = 0; i < MAX_CNAME_CHAIN; i++) {
    const last = msg.answers?.[msg.answers.length - 1];
    if (!last || last.type !== 'CNAME' || q.qtype === 'CNAME') return msg;
    const target = normalizeName(last.data);
    const zone = ZONES.find((z) => inZone(target, z.origin));
    if (!zone) return msg;
    const next = answerQuery({ ...q, qname: target }, zone.records, zone.origin);
    if (!next.answers?.length) return msg;
    msg = { ...msg, answers: [...(msg.answers ?? []), ...next.answers] };
  }
  return msg;
}
