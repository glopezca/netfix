/**
 * /etc/nsswitch.conf of an Ubuntu host: the order of the «hosts:» sources the resolver of every GNU/Linux program
 * follows (files, mdns4_minimal, dns, wins…). Ubuntu Server ships «files dns»; libnss-mdns adds mdns4_minimal when it is
 * installed (and takes it out when removed), as its maintainer scripts do; wins is added by hand.
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

export interface HostsSource {
  readonly source: string;
  /** Followed by [NOTFOUND=return]: a «not found» from this source ends the lookup. */
  readonly notFoundReturn: boolean;
}

/** The sources of «hosts:», without files (the caller asks /etc/hosts first). */
export function hostsSources(host: Host): HostsSource[] {
  const text = peekHostFile(host, NSSWITCH) ?? seededNsswitch(host);
  const line = /^hosts:[ \t]*(.*)$/m.exec(text.replace(/#.*$/gm, ''))?.[1] ?? 'files dns';
  const words = line.trim().split(/\s+/);
  return words.flatMap((w, i) => (w.startsWith('[') || w === 'files' ? [] : [{ source: w, notFoundReturn: /NOTFOUND=return/i.test(words[i + 1] ?? '') }]));
}

const MDNS = 'mdns4_minimal [NOTFOUND=return]';

/** libnss-mdns's postinst / postrm: mdns4_minimal [NOTFOUND=return] before dns in «hosts:», or out of it. */
export function withMdns(text: string, on: boolean): string {
  return text.replace(/^(hosts:[ \t]*)(.*)$/m, (_all, head: string, rest: string) => {
    const clean = rest.replace(/\s*mdns4_minimal(\s*\[NOTFOUND=return\])?/g, '').trim();
    if (!on) return `${head}${clean}`;
    return `${head}${/\bdns\b/.test(clean) ? clean.replace(/\bdns\b/, `${MDNS} dns`) : `${clean} ${MDNS}`}`;
  });
}

/** The file a host starts with: Ubuntu's, with mdns4_minimal when libnss-mdns came installed (a file saved before v0.28). */
export function seededNsswitch(host: Host): string {
  return withMdns(DEFAULT_NSSWITCH, hasPackage(host, 'libnss-mdns') || hasPackage(host, 'avahi-daemon'));
}
