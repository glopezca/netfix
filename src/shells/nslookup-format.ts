/** nslookup output: BIND 9 on Ubuntu and Windows, for every record type and with `set debug`. */
import type { DnsAnswer, DnsMessage } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { formatIp } from '../core/ip.ts';

/** How the server is shown and whether `set debug` is on. */
export interface NsView {
  /** Windows: the server's name from its PTR record, `[ip]` or UnKnown. Linux: the name or address as given. */
  readonly serverLabel?: string;
  readonly debug?: boolean;
}

const WIN_INDENT = '        ';
const DURATION_UNITS: readonly [number, string][] = [[86400, 'day'], [3600, 'hour'], [60, 'min'], [1, 'sec']];

/** Windows writes TTLs and SOA timers as "604800 (7 days)", "299 (4 mins 59 secs)". */
export function winDuration(seconds: number): string {
  let rest = seconds;
  const parts: string[] = [];
  for (const [size, unit] of DURATION_UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`);
  }
  return `${seconds} (${parts.join(' ') || '0 secs'})`;
}

function soaFields(data: string): string[] {
  return data.split(' ').map((f) => f.replace(/\.$/, ''));
}

/** The "key = value" lines of one record, without its owner name. */
function body(a: DnsAnswer, windows: boolean): string[] {
  const dot = windows ? '' : '.';
  switch (a.type) {
    case 'A': return [`internet address = ${a.data}`];
    case 'CNAME': return [`canonical name = ${a.data}${dot}`];
    case 'MX': return [windows ? `MX preference = ${a.priority ?? 10}, mail exchanger = ${a.data}` : `mail exchanger = ${a.priority ?? 10} ${a.data}.`];
    case 'NS': return [`nameserver = ${a.data}${dot}`];
    case 'PTR': return [`name = ${a.data}${dot}`];
    case 'TXT': return [`text = "${a.data}"`];
    case 'SOA': {
      const [mname = '', rname = '', serial = '0', refresh = '0', retry = '0', expire = '0', minimum = '0'] = soaFields(a.data);
      if (!windows) return [`origin = ${mname}`, `mail addr = ${rname}`, `serial = ${serial}`, `refresh = ${refresh}`, `retry = ${retry}`, `expire = ${expire}`, `minimum = ${minimum}`];
      const t = (s: string): string => winDuration(Number(s));
      return [`primary name server = ${mname}`, `responsible mail addr = ${rname}`, `serial  = ${serial}`, `refresh = ${t(refresh)}`, `retry   = ${t(retry)}`, `expire  = ${t(expire)}`, `default TTL = ${t(minimum)}`];
    }
  }
}

/** A record as nslookup lists it: on its owner's line, or under it (SOA, Windows TXT). */
function record(a: DnsAnswer, windows: boolean): string[] {
  const lines = body(a, windows);
  const indent = windows ? WIN_INDENT : '\t';
  if (a.type === 'SOA') return [a.name, ...lines.map((l) => `${indent}${l}`)];
  if (a.type === 'TXT' && windows) return [`${a.name}\ttext =`, '', `${indent}"${a.data}"`];
  return [`${a.name}\t${lines[0] ?? ''}`];
}

function debugSection(title: string, list: readonly DnsAnswer[], windows: boolean): string[] {
  const indent = windows ? WIN_INDENT : '\t';
  if (windows && list.length === 0 && title !== 'ANSWERS') return [];
  return [`    ${title}:`, ...list.flatMap((a) => [`    ->  ${a.name}`, ...body(a, windows).map((l) => `${indent}${l}`), `${indent}ttl = ${windows ? winDuration(a.ttl) : a.ttl}`])];
}

/** The `set debug` dump of one answer. */
function debugBlock(m: DnsMessage, windows: boolean): string[] {
  const answers = m.answers ?? [];
  const authority = m.authority ?? [];
  const additional = m.additional ?? [];
  const question = `${windows ? WIN_INDENT : '\t'}${m.qname}, type = ${m.qtype}, class = IN`;
  const sections = [...debugSection('ANSWERS', answers, windows), ...debugSection('AUTHORITY RECORDS', authority, windows), ...debugSection('ADDITIONAL RECORDS', additional, windows)];
  if (!windows) return ['------------', '    QUESTIONS:', question, ...sections, '------------'];
  const flags = ['response', ...(m.authoritative ? ['auth. answer'] : []), 'want recursion', ...(m.ra ? ['recursion avail'] : [])].join(', ');
  return ['------------', 'Got answer:', '    HEADER:',
    `${WIN_INDENT}opcode = QUERY, id = ${m.id}, rcode = ${m.rcode ?? 'NOERROR'}`,
    `${WIN_INDENT}header flags:  ${flags}.`,
    `${WIN_INDENT}questions = 1,  answers = ${answers.length},  authority records = ${authority.length},  additional = ${additional.length}`,
    '', '    QUESTIONS:', question, ...sections, '', '------------'];
}

function failure(m: DnsMessage, label: string, name: string, windows: boolean): string[] {
  const soa = (m.authority ?? []).filter((a) => a.type === 'SOA');
  if (windows) {
    if (m.rcode === 'NOERROR') return soa.flatMap((a) => record(a, true));
    return [`*** ${label} can't find ${name}: ${m.rcode === 'NXDOMAIN' ? 'Non-existent domain' : m.rcode === 'REFUSED' ? 'Query refused' : m.rcode === 'SERVFAIL' ? 'Server failed' : 'No response from server'}`];
  }
  if (m.rcode !== 'NOERROR') return [`** server can't find ${name}: ${m.rcode}`];
  return [`*** Can't find ${name}: No answer`, ...(soa.length ? ['', 'Authoritative answers can be found from:', ...soa.flatMap((a) => record(a, false))] : [])];
}

/** The answer itself: A lookups as Name/Address, an IP as its PTR name, the rest one record per line. */
function answerLines(m: DnsMessage, name: string, windows: boolean): string[] {
  const all = m.answers ?? [];
  const aliases = all.filter((a) => a.type === 'CNAME');
  const auth = m.authoritative ? [] : ['Non-authoritative answer:'];
  if (m.qtype === 'PTR' && windows && /^\d+(\.\d+){3}$/.test(name)) return all.filter((a) => a.type === 'PTR').map((a) => `Name:    ${a.data}\nAddress:  ${name}`);
  if (m.qtype !== 'A') return [...auth, ...all.flatMap((a) => record(a, windows)), ''];
  const addrs = all.filter((a) => a.type === 'A');
  if (windows) {
    const lines = [`Name:    ${addrs[0]?.name ?? name}`, `Address${addrs.length > 1 ? 'es' : ''}:  ${addrs.map((a) => a.data).join('\n          ')}`];
    return [...auth, ...lines, ...(aliases.length ? [`Aliases:  ${aliases.map((a) => a.name).join(', ')}`] : []), ''];
  }
  return [...auth, ...aliases.flatMap((a) => record(a, false)), ...addrs.flatMap((a) => [`Name:\t${a.name}`, `Address: ${a.data}`]), ''];
}

function wanted(m: DnsMessage): boolean {
  return (m.answers ?? []).some((a) => a.type === m.qtype);
}

export function serverHead(label: string, ip: number, windows: boolean, prefix = ''): string[] {
  const addr = formatIp(ip);
  if (windows) return [`${prefix ? 'Default Server' : 'Server'}:  ${label}`, `Address:  ${addr}`, ''];
  return prefix ? [`Default server: ${label}`, `Address: ${addr}#53`] : [`Server:\t\t${label}`, `Address:\t${addr}#53`, ''];
}

export function nslookupOutput(name: string, r: DnsResult, windows: boolean, view: NsView = {}): string[] {
  if (r.kind === 'noserver') return windows ? ['*** Default servers are not available', 'Server:  UnKnown', 'Address:  127.0.0.1', '', `*** UnKnown can't find ${name}: No response from server`] : [';; connection timed out; no servers could be reached'];
  const server = formatIp(r.server);
  const label = view.serverLabel ?? (windows ? 'UnKnown' : server);
  if (r.kind === 'timeout') return windows ? ['DNS request timed out.', '    timeout was 2 seconds.', `Server:  ${label}`, `Address:  ${server}`, '', `*** Request to ${label} timed-out`] : [';; connection timed out; no servers could be reached'];
  const m = r.msg;
  const head = serverHead(label, r.server, windows);
  const debug = view.debug ? debugBlock(m, windows) : [];
  return [...head, ...debug, ...(wanted(m) ? answerLines(m, name, windows) : failure(m, label, name, windows))];
}
