/**
 * Extended IP access lists (100-199 and `ip access-list extended NAME`): protocol, source and destination
 * with wildcards, TCP/UDP port operators (eq gt lt neq range), `established`, ICMP types and `log`.
 */
import type { IpPacket } from '../net/packets.ts';
import { parseSource } from './acl-addr.ts';
import { formatIp } from '../core/ip.ts';

export type AclProto = 'ip' | 'tcp' | 'udp' | 'icmp' | 'esp' | 'ahp' | 'gre';

export type PortSpec =
  | { readonly op: 'eq' | 'gt' | 'lt' | 'neq'; readonly port: number }
  | { readonly op: 'range'; readonly port: number; readonly to: number };

export interface AddrSpec {
  readonly ip: number;
  readonly wildcard: number;
}

export interface ExtFields {
  readonly proto: AclProto;
  readonly dst: AddrSpec;
  readonly sport?: PortSpec;
  readonly dport?: PortSpec;
  readonly established?: boolean;
  readonly icmp?: string;
  readonly log?: boolean;
}

/** IOS keywords for well-known ports (what show/running-config print instead of the number). */
const TCP_NAMES: Readonly<Record<string, number>> = { bgp: 179, chargen: 19, cmd: 514, daytime: 13, discard: 9, domain: 53, echo: 7, exec: 512, finger: 79, ftp: 21, 'ftp-data': 20, gopher: 70, hostname: 101, ident: 113, irc: 194, klogin: 543, kshell: 544, login: 513, lpd: 515, nntp: 119, 'pim-auto-rp': 496, pop2: 109, pop3: 110, smtp: 25, sunrpc: 111, tacacs: 49, talk: 517, telnet: 23, time: 37, uucp: 540, whois: 43, www: 80 };
const UDP_NAMES: Readonly<Record<string, number>> = { biff: 512, bootpc: 68, bootps: 67, discard: 9, dnsix: 195, domain: 53, echo: 7, isakmp: 500, 'mobile-ip': 434, nameserver: 42, 'netbios-dgm': 138, 'netbios-ns': 137, 'netbios-ss': 139, 'non500-isakmp': 4500, ntp: 123, 'pim-auto-rp': 496, rip: 520, snmp: 161, snmptrap: 162, sunrpc: 111, syslog: 514, tacacs: 49, talk: 517, tftp: 69, time: 37, who: 513, xdmcp: 177 };
const ICMP_NAMES = ['echo', 'echo-reply', 'unreachable', 'time-exceeded', 'administratively-prohibited', 'host-unreachable', 'port-unreachable'];
const ICMP_OF: Readonly<Record<string, string>> = { 'echo-request': 'echo', 'echo-reply': 'echo-reply', unreachable: 'unreachable', 'ttl-exceeded': 'time-exceeded' };
const INVALID = '% Invalid input detected.';

function names(proto: AclProto): Readonly<Record<string, number>> {
  return proto === 'udp' ? UDP_NAMES : TCP_NAMES;
}

function port(proto: AclProto, word: string | undefined): number | null {
  if (word === undefined) return null;
  if (/^\d+$/.test(word)) return Number(word) <= 65535 ? Number(word) : null;
  return names(proto)[word] ?? null;
}

/** `eq www` / `range 1000 2000` at `words[i]`; returns the spec and how many words it used. */
function portSpec(proto: AclProto, words: readonly string[], i: number): { spec: PortSpec; used: number } | null | 'none' {
  const op = words[i];
  if (op !== 'eq' && op !== 'gt' && op !== 'lt' && op !== 'neq' && op !== 'range') return 'none';
  if (proto !== 'tcp' && proto !== 'udp') return null;
  const a = port(proto, words[i + 1]);
  if (a === null) return null;
  if (op !== 'range') return { spec: { op, port: a }, used: 2 };
  const b = port(proto, words[i + 2]);
  return b === null || b < a ? null : { spec: { op, port: a, to: b }, used: 3 };
}

/** Address at `words[i]` (any | host A | A W): the spec and the words used. */
function address(words: readonly string[], i: number): { spec: AddrSpec; used: number } | null {
  const w = words[i];
  if (w === undefined) return null;
  const take = w === 'any' ? 1 : 2;
  const r = parseSource(words.slice(i, i + take));
  return typeof r === 'string' ? null : { spec: r, used: take };
}

/** Parses `SRC [port] DST [port] [established] [icmp-type] [log]` for a protocol. */
export function parseExtended(proto: AclProto, words: readonly string[]): { src: AddrSpec; ext: ExtFields } | string {
  const src = address(words, 0);
  if (!src) return INVALID;
  let i = src.used;
  const sp = portSpec(proto, words, i);
  if (sp === null) return INVALID;
  if (sp !== 'none') i += sp.used;
  const dst = address(words, i);
  if (!dst) return words[i] === undefined ? '% Incomplete command.' : INVALID;
  i += dst.used;
  const dp = portSpec(proto, words, i);
  if (dp === null) return INVALID;
  if (dp !== 'none') i += dp.used;
  let established = false;
  let icmp: string | undefined;
  let log = false;
  for (const w of words.slice(i)) {
    if (w === 'established' && proto === 'tcp') established = true;
    else if (proto === 'icmp' && ICMP_NAMES.includes(w) && icmp === undefined) icmp = w;
    else if (w === 'log' || w === 'log-input') log = true;
    else return INVALID;
  }
  const ext: ExtFields = { proto, dst: dst.spec, ...(sp !== 'none' ? { sport: sp.spec } : {}), ...(dp !== 'none' ? { dport: dp.spec } : {}), ...(established ? { established } : {}), ...(icmp ? { icmp } : {}), ...(log ? { log } : {}) };
  return { src: src.spec, ext };
}

const inAddr = (a: AddrSpec, ip: number): boolean => ((ip & ~a.wildcard) >>> 0) === ((a.ip & ~a.wildcard) >>> 0);

function portMatches(s: PortSpec | undefined, p: number | undefined): boolean {
  if (!s) return true;
  if (p === undefined) return false;
  switch (s.op) {
    case 'eq': return p === s.port;
    case 'neq': return p !== s.port;
    case 'gt': return p > s.port;
    case 'lt': return p < s.port;
    case 'range': return p >= s.port && p <= s.to;
  }
}

function protoMatches(proto: AclProto, p: IpPacket): boolean {
  if (proto === 'ip') return true;
  if (proto === 'esp') return p.protocol === ('esp' as IpPacket['protocol']);
  return p.protocol === proto;
}

export function extMatches(src: AddrSpec, e: ExtFields, p: IpPacket): boolean {
  if (!protoMatches(e.proto, p) || !inAddr(src, p.src) || !inAddr(e.dst, p.dst)) return false;
  const l4 = p.tcp ?? p.udp;
  if (!portMatches(e.sport, l4?.sport) || !portMatches(e.dport, l4?.dport)) return false;
  if (e.established && !(p.tcp && (p.tcp.flags.includes('ACK') || p.tcp.flags.includes('RST')))) return false;
  if (e.icmp && (!p.icmp || ICMP_OF[p.icmp.type] !== e.icmp)) return false;
  return true;
}

function addrText(a: AddrSpec): string {
  if (a.wildcard === 0xffffffff) return 'any';
  if (a.wildcard === 0) return `host ${formatIp(a.ip)}`;
  return `${formatIp(a.ip)} ${formatIp(a.wildcard)}`;
}

function portText(proto: AclProto, s: PortSpec | undefined): string {
  if (!s) return '';
  const name = (n: number): string => Object.entries(names(proto)).find(([, v]) => v === n)?.[0] ?? String(n);
  return s.op === 'range' ? ` range ${name(s.port)} ${name(s.to)}` : ` ${s.op} ${name(s.port)}`;
}

/** `tcp any host 10.0.0.2 eq www established log` (running-config and show use the same text). */
export function extText(src: AddrSpec, e: ExtFields): string {
  return `${e.proto} ${addrText(src)}${portText(e.proto, e.sport)} ${addrText(e.dst)}${portText(e.proto, e.dport)}${e.icmp ? ` ${e.icmp}` : ''}${e.established ? ' established' : ''}${e.log ? ' log' : ''}`;
}
