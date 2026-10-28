/** dig and host output formats (nslookup: nslookup-format.ts). */
import type { DnsMessage, DnsAnswer, DnsType } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { formatIp } from '../core/ip.ts';
import { dateLine } from './net-tools.ts';

const DIG_VERSION = '9.20.4-3ubuntu1-Ubuntu';

function rr(a: DnsAnswer): string {
  const data = a.type === 'A' || a.type === 'TXT' || a.type === 'SOA' ? (a.type === 'TXT' ? `"${a.data}"` : a.data) : `${a.data}.`;
  const soa = a.type === 'SOA' ? a.data.replace(/^(\S+) (\S+)/, '$1. $2.') : data;
  return `${`${a.name}.`.padEnd(24)}${String(a.ttl).padEnd(8)}IN\t${a.type}\t${a.type === 'MX' ? `${a.priority ?? 10} ` : ''}${soa}`;
}

export function digOutput(name: string, type: DnsType, r: DnsResult, short: boolean, now: number): string[] {
  // No nameserver in resolv.conf: dig falls back to the loopback, where nothing listens.
  if (r.kind === 'noserver') {
    const refused = ';; communications error to 127.0.0.1#53: connection refused';
    return [refused, refused, refused, '', `; <<>> DiG ${DIG_VERSION} <<>> ${name}`, ';; global options: +cmd', ';; no servers could be reached'];
  }
  const server = formatIp(r.server);
  if (r.kind === 'timeout') return [`;; communications error to ${server}#53: timed out`, `;; communications error to ${server}#53: timed out`, '', `; <<>> DiG ${DIG_VERSION} <<>> ${name}`, ';; global options: +cmd', ';; no servers could be reached'];
  const m = r.msg;
  const answers = m.answers ?? [];
  if (short) return answers.map((a) => (a.type === 'A' || a.type === 'TXT' ? a.data : a.type === 'MX' ? `${a.priority ?? 10} ${a.data}.` : `${a.data}.`));
  const flags = ['qr', m.authoritative ? 'aa' : '', 'rd', m.ra ? 'ra' : ''].filter(Boolean).join(' ');
  const out = [
    `; <<>> DiG ${DIG_VERSION} <<>> ${name}${type !== 'A' ? ` ${type}` : ''}`,
    ';; global options: +cmd',
    ';; Got answer:',
    `;; ->>HEADER<<- opcode: QUERY, status: ${m.rcode ?? 'NOERROR'}, id: ${m.id}`,
    `;; flags: ${flags}; QUERY: 1, ANSWER: ${answers.length}, AUTHORITY: ${m.authority?.length ?? 0}, ADDITIONAL: 0`,
    ...(m.ra ? [] : [';; WARNING: recursion requested but not available']),
    '',
    ';; QUESTION SECTION:',
    `;${`${m.qname}.`.padEnd(23)}\tIN\t${m.qtype}`,
  ];
  if (answers.length) out.push('', ';; ANSWER SECTION:', ...answers.map(rr));
  if (m.authority?.length) out.push('', ';; AUTHORITY SECTION:', ...m.authority.map(rr));
  out.push('', ';; Query time: 1 msec', `;; SERVER: ${server}#53(${server}) (UDP)`, `;; WHEN: ${dateLine(now)}`, `;; MSG SIZE  rcvd: ${48 + answers.length * 16}`, '');
  return out;
}

export function hostOutput(name: string, r: DnsResult): string[] {
  if (r.kind !== 'answer') return [';; connection timed out; no servers could be reached'];
  const m = r.msg;
  if (m.rcode === 'NXDOMAIN' || m.rcode === 'REFUSED') return [`Host ${name} not found: ${m.rcode === 'NXDOMAIN' ? '3(NXDOMAIN)' : '5(REFUSED)'}`];
  return (m.answers ?? []).map((a) => {
    if (a.type === 'A') return `${a.name} has address ${a.data}`;
    if (a.type === 'CNAME') return `${a.name} is an alias for ${a.data}.`;
    if (a.type === 'MX') return `${a.name} mail is handled by ${a.priority ?? 10} ${a.data}.`;
    if (a.type === 'PTR') return `${a.name} domain name pointer ${a.data}.`;
    return `${a.name} ${a.type} ${a.data}`;
  });
}
