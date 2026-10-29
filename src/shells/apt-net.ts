/**
 * What apt fetches, over the simulated network: the sources of /etc/apt (deb822 files and one-line `deb` entries) and,
 * for each mirror, whether it can be reached (resolver, then an HTTP request for an index), with apt's own error text.
 */
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';
import { resolveHost, tcpCall } from './net-tools.ts';
import { formatIp } from '../core/ip.ts';

export interface AptSource {
  /** Without the trailing slash, as apt prints it: http://archive.ubuntu.com/ubuntu */
  readonly uri: string;
  readonly suite: string;
}

const SOURCES_DIR = '/etc/apt/sources.list.d';
const SOURCES_LIST = '/etc/apt/sources.list';

function deb822(text: string): AptSource[] {
  return text.split(/\n\s*\n/).flatMap((stanza) => {
    const field = (name: string): string[] => (new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(stanza)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
    if (!field('Types').includes('deb') || /^Enabled:\s*no\s*$/mi.test(stanza)) return [];
    return field('URIs').flatMap((uri) => field('Suites').map((suite) => ({ uri: uri.replace(/\/+$/, ''), suite })));
  });
}

function oneLine(text: string): AptSource[] {
  return text.split('\n').flatMap((line) => {
    const m = /^\s*deb\s+(?:\[[^\]]*\]\s+)?(\S+)\s+(\S+)/.exec(line);
    return m ? [{ uri: (m[1] ?? '').replace(/\/+$/, ''), suite: m[2] ?? '' }] : [];
  });
}

/** Every source, in the order apt reads them (sources.list, then sources.list.d in name order). */
export function aptSources(fs: Vfs): AptSource[] {
  const read = (path: string): string => { try { return fs.readFile(path); } catch { return ''; } };
  const files = (() => { try { return fs.readdir(SOURCES_DIR).sort(); } catch { return []; } })();
  return [
    ...oneLine(read(SOURCES_LIST)),
    ...files.filter((f) => f.endsWith('.list')).flatMap((f) => oneLine(read(`${SOURCES_DIR}/${f}`))),
    ...files.filter((f) => f.endsWith('.sources')).flatMap((f) => deb822(read(`${SOURCES_DIR}/${f}`))),
  ];
}

const hostOf = (uri: string): string => uri.replace(/^\w+:\/\//, '').split(/[/:]/)[0] ?? '';

/** Undefined when the mirror answers; else apt's reason («Temporary failure resolving 'x'»…). */
export function reachMirror(host: Host, uri: string, path: string): string | undefined {
  const name = hostOf(uri);
  const target = resolveHost(host, name);
  if (target.kind === 'error') return target.reason === 'nxdomain' || target.reason === 'nodata' ? `Could not resolve '${name}'` : `Temporary failure resolving '${name}'`;
  const r = tcpCall(host, target.ip, 80, { app: 'HTTP', kind: 'request', method: 'GET', host: name, path: `/${uri.replace(/^\w+:\/\/[^/]*\/?/, '')}/${path}`.replace(/\/+/g, '/'), headers: { host: name, 'user-agent': 'Debian APT-HTTP/1.3 (3.1.6ubuntu2)' } });
  if (r.kind === 'ok') return undefined;
  const at = `${name}:80 (${formatIp(target.ip)})`;
  return r.kind === 'refused' ? `Could not connect to ${at}. - connect (111: Connection refused)` : `Could not connect to ${at}, connection timed out`;
}

/** One check per mirror host (apt keeps the connection): the first reason found for each. */
export function mirrorStatus(host: Host): (uri: string, path: string) => string | undefined {
  const seen = new Map<string, string | undefined>();
  return (uri, path) => {
    const key = hostOf(uri);
    if (!seen.has(key)) seen.set(key, reachMirror(host, uri, path));
    return seen.get(key);
  };
}
