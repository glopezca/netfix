/**
 * /etc/nsswitch.conf of an Ubuntu host: the order of the «hosts:» sources the resolver of every GNU/Linux program
 * follows (files, mdns4_minimal, resolve, dns, wins…) and the [STATUS=action] items after each. Ubuntu Server ships
 * «files dns»; libnss-mdns adds mdns4_minimal and libnss-resolve adds resolve when installed (and take them out when
 * removed), as their maintainer scripts do; wins is added by hand.
 */
import type { Host } from '../devices/host.ts';
import { peekHostFile } from '../devices/host-fs.ts';
import { hasPackage } from '../net/host-packages.ts';

export const NSSWITCH = '/etc/nsswitch.conf';

export const DEFAULT_NSSWITCH = `# /etc/nsswitch.conf
#
# Example configuration of GNU Name Service Switch functionality.
# If you have the \`glibc-doc-reference' and \`info' packages installed, try:
# \`info libc "Name Service Switch"' for information about this file.

passwd:         files systemd
group:          files systemd
shadow:         files systemd
gshadow:        files systemd

hosts:          files dns
networks:       files

protocols:      db files
services:       db files
ethers:         db files
rpc:            db files

netgroup:       nis
`;

export type NssStatus = 'SUCCESS' | 'NOTFOUND' | 'UNAVAIL' | 'TRYAGAIN';

/** One [STATUS=action] item; [!STATUS=action] applies the action to every other status. */
export interface NssAction {
  readonly status: NssStatus;
  readonly negate: boolean;
  readonly action: 'return' | 'continue' | 'merge';
}

export interface HostsSource {
  readonly source: string;
  readonly actions: readonly NssAction[];
  /** A «not found» from this source ends the lookup ([NOTFOUND=return], or [!UNAVAIL=return]). */
  readonly notFoundReturn: boolean;
}

/** glibc reads at most this much of the line and this many sources (a crafted file is not walked to the end). */
const MAX_LINE = 4096;
const MAX_SOURCES = 32;
const STATUSES: readonly NssStatus[] = ['SUCCESS', 'NOTFOUND', 'UNAVAIL', 'TRYAGAIN'];

function parseActions(inside: string): NssAction[] {
  const items = inside.replace(/\s*=\s*/g, '=').trim().split(/\s+/);
  return items.flatMap((item) => {
    const m = /^(!?)([a-z]+)=([a-z]+)$/i.exec(item);
    const status = m?.[2]?.toUpperCase() as NssStatus | undefined;
    const action = m?.[3]?.toLowerCase();
    if (!m || !status || !STATUSES.includes(status) || (action !== 'return' && action !== 'continue' && action !== 'merge')) return [];
    return [{ status, negate: m[1] === '!', action }];
  });
}

/** What glibc does after a source answered with this status: SUCCESS returns and the rest continue, unless an item says otherwise. */
export function nssNext(actions: readonly NssAction[], status: NssStatus): 'return' | 'continue' {
  const hit = actions.find((a) => (a.negate ? a.status !== status : a.status === status));
  if (!hit) return status === 'SUCCESS' ? 'return' : 'continue';
  return hit.action === 'continue' ? 'continue' : 'return';
}

/** The sources of a «hosts:» line with their actions, in order (files is /etc/hosts). */
export function parseHostsLine(line: string): HostsSource[] {
  const out: { source: string; actions: NssAction[] }[] = [];
  for (const m of line.slice(0, MAX_LINE).matchAll(/\[([^\]]*)\]|([^\s[\]]+)/g)) {
    const last = out[out.length - 1];
    if (m[1] !== undefined) last?.actions.push(...parseActions(m[1]));
    else if (out.length >= MAX_SOURCES) break;
    else out.push({ source: m[2] ?? '', actions: [] });
  }
  return out.map((s) => ({ ...s, notFoundReturn: nssNext(s.actions, 'NOTFOUND') === 'return' }));
}

/** The sources of «hosts:» in the host's /etc/nsswitch.conf (Ubuntu's when the file is not there). */
export function hostsSources(host: Host): HostsSource[] {
  const text = peekHostFile(host, NSSWITCH) ?? seededNsswitch(host);
  return parseHostsLine(/^hosts:[ \t]*(.*)$/m.exec(text.replace(/#.*$/gm, ''))?.[1] ?? 'files dns');
}

const MDNS = 'mdns4_minimal [NOTFOUND=return]';
const RESOLVE = 'resolve [!UNAVAIL=return]';

/** Edits the «hosts:» line: the source out, then (on) in again before the first of `before`, or at the end. */
function editHosts(text: string, strip: RegExp, entry: string, before: RegExp, on: boolean): string {
  return text.replace(/^(hosts:[ \t]*)(.*)$/m, (_all, head: string, rest: string) => {
    const clean = rest.replace(strip, '').trim();
    if (!on) return `${head}${clean}`;
    const m = before.exec(clean);
    return `${head}${m ? `${clean.slice(0, m.index)}${entry} ${clean.slice(m.index)}` : `${clean} ${entry}`.trim()}`;
  });
}

/** libnss-mdns's postinst / postrm: mdns4_minimal [NOTFOUND=return] before resolve or dns in «hosts:», or out of it. */
export function withMdns(text: string, on: boolean): string {
  return editHosts(text, /\s*\bmdns4_minimal\b(\s*\[NOTFOUND=return\])?/g, MDNS, /\b(resolve|dns)\b/, on);
}

/** libnss-resolve's postinst / postrm: resolve [!UNAVAIL=return] before dns in «hosts:», or out of it. */
export function withResolve(text: string, on: boolean): string {
  return editHosts(text, /\s*\bresolve\b(\s*\[!UNAVAIL=return\])?/g, RESOLVE, /\bdns\b/, on);
}

/** The file a host starts with: Ubuntu's, with mdns4_minimal when libnss-mdns came installed (a file saved before v0.28). */
export function seededNsswitch(host: Host): string {
  const mdns = withMdns(DEFAULT_NSSWITCH, hasPackage(host, 'libnss-mdns') || hasPackage(host, 'avahi-daemon'));
  return withResolve(mdns, hasPackage(host, 'libnss-resolve'));
}

/** The panel of winbind: «wins» at the end of «hosts:», or out of it (the edit an administrator makes by hand). */
export function withWins(text: string, on: boolean): string {
  return editHosts(text, /\s*\bwins\b/g, 'wins', /$^/, on);
}
