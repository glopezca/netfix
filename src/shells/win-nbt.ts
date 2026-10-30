/**
 * The NetBIOS tools of a Windows terminal: `nbtstat` (local name table, remote table by name or address, cache, purge)
 * and `net view \\NAME` (an SMB server's shares: it asks for the name, then connects to TCP 445).
 */
import type { Host } from '../devices/host.ts';
import type { NbnsName } from '../net/packets.ts';
import { WORKSTATION, nbnsAsk, nbnsCache, nbnsResolve, ownNames, purgeNbnsCache } from '../net/netbios.ts';
import { runSync } from '../net/sync.ts';
import type { ProbeResult } from '../net/tcp.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { resolveHost } from './net-tools.ts';

const RULE = `    ${'-'.repeat(45)}`;
const CACHE_RULE = `    ${'-'.repeat(60)}`;
const suffixOf = (n: number): string => `<${n.toString(16).toUpperCase().padStart(2, '0')}>`;
const nameRow = (n: NbnsName): string => `    ${n.name.padEnd(15)}${suffixOf(n.suffix)}  ${(n.group ? 'GROUP' : 'UNIQUE').padEnd(12)}Registered`;
const winMac = (mac: string): string => (mac.match(/../g) ?? []).join('-').toUpperCase();

function header(host: Host): string[] {
  const ip = host.config.ip;
  return ['', 'Ethernet:', `Node IpAddress: [${ip !== undefined ? formatIp(ip) : '0.0.0.0'}] Scope Id: []`, ''];
}

function remote(host: Host, target: string, byAddress: boolean): string[] {
  const ip = byAddress ? parseIp(target) ?? undefined : nbnsResolve(host, target, WORKSTATION);
  const status = ip === undefined ? undefined : nbnsAsk(host, { type: 'NBSTAT', name: '*', suffix: WORKSTATION, broadcast: false }, ip);
  if (!status?.names) return [...header(host), '    Host not found.', ''];
  return [...header(host), '           NetBIOS Remote Machine Name Table', '', '       Name               Type         Status', RULE,
    ...status.names.map(nameRow), '', `    MAC Address = ${winMac(status.mac ?? '')}`, ''];
}

function cache(host: Host): string[] {
  const rows = nbnsCache(host);
  if (!rows.length) return [...header(host), '    No names in cache', ''];
  return [...header(host), '                  NetBIOS Remote Cache Name Table', '', '        Name              Type       Host Address    Life [sec]', CACHE_RULE,
    ...rows.map(([name, suffix, ip, life]) => `    ${name.padEnd(15)}${suffixOf(suffix)}  UNIQUE          ${formatIp(ip).padEnd(16)}${String(life).padStart(5)}`), ''];
}

const USAGE = ['', 'Displays protocol statistics and current TCP/IP connections using NBT (NetBIOS over TCP/IP).', '',
  'NBTSTAT [ [-a RemoteName] [-A IP address] [-c] [-n] [-R] ]', ''];

export function nbtstat(host: Host, args: readonly string[]): string[] {
  const [flag, value] = args;
  if (flag === '-n') return [...header(host), '                NetBIOS Local Name Table', '', '       Name               Type         Status', RULE, ...ownNames(host).map(nameRow), ''];
  if (flag === '-c') return cache(host);
  if (flag === '-R') { purgeNbnsCache(host); return ['    Successful purge and preload of the NBT Remote Cache Name Table.', '']; }
  if ((flag === '-a' || flag === '-A') && value) return remote(host, value, flag === '-A');
  return USAGE;
}

const SMB_PORT = 445;
const PROBE_MS = 3000;

/** `net view \\NAME`: the name the Windows way, then SMB on 445 (a default host shares nothing visible). */
export function netView(host: Host, unc: string | undefined): string[] {
  const name = (unc ?? '').replace(/^\\\\/, '');
  if (!name) return ['The syntax of this command is:', '', 'NET VIEW', '[\\\\computername [/CACHE] | [/ALL] | /DOMAIN[:domainname]]'];
  const r = resolveHost(host, name, 'windows');
  const open = r.kind === 'ip' && runSync<ProbeResult>(host.hooks, (done) => host.tcp.probe(r.ip, SMB_PORT, done, PROBE_MS), PROBE_MS + 500) === 'open';
  return open ? ['There are no entries in the list.', ''] : ['System error 53 has occurred.', '', 'The network path was not found.', ''];
}
