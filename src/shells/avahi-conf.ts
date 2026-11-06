/**
 * /etc/avahi/avahi-daemon.conf as Ubuntu's avahi-daemon ships it (its commented defaults kept), and the two settings
 * Netfix reads from it when avahi-daemon starts: `host-name=` in [server] and `disable-publishing=` in [publish].
 */
import type { AvahiConfig } from '../net/avahi.ts';

export const AVAHI_CONF = '/etc/avahi/avahi-daemon.conf';

export const DEFAULT_AVAHI_CONF = `# This file is part of avahi.
#
# avahi is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as
# published by the Free Software Foundation; either version 2 of the
# License, or (at your option) any later version.
#
# avahi is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
# or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
# License for more details.
#
# You should have received a copy of the GNU Lesser General Public
# License along with avahi; if not, write to the Free Software
# Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307
# USA.

# See avahi-daemon.conf(5) for more information on this configuration
# file!

[server]
#host-name=foo
#domain-name=local
#browse-domains=0pointer.de, zeroconf.org
use-ipv4=yes
use-ipv6=yes
#allow-interfaces=eth0
#deny-interfaces=eth1
#check-response-ttl=no
#use-iff-running=no
#enable-dbus=yes
#disallow-other-stacks=no
#allow-point-to-point=no
#cache-entries-max=4096
#clients-max=4096
#objects-per-client-max=1024
#entries-per-entry-group-max=32
ratelimit-interval-usec=1000000
ratelimit-burst=1000

[wide-area]
enable-wide-area=yes

[publish]
#disable-publishing=no
#disable-user-service-publishing=no
#add-service-cookie=no
#publish-addresses=yes
publish-hinfo=no
publish-workstation=no
#publish-domain=yes
#publish-dns-servers=192.168.50.1, 192.168.50.2
#publish-resolv-conf-dns-servers=yes
#publish-aaaa-on-ipv4=yes
#publish-a-on-ipv6=no

[reflector]
#enable-reflector=no
#reflect-ipv=no
#reflect-filters=_airplay._tcp.local,_raop._tcp.local

[rlimits]
#rlimit-as=
#rlimit-core=0
#rlimit-data=8388608
#rlimit-fsize=0
#rlimit-nofile=768
#rlimit-stack=8388608
#rlimit-nproc=3
`;

/** A host label avahi accepts: letters, digits and hyphens, up to 63 (it would refuse to start otherwise). */
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export const validAvahiName = (name: string): boolean => name === '' || LABEL.test(name);

/** The key's value in a section (the last uncommented line wins), or undefined. */
function value(text: string, section: string, key: string): string | undefined {
  let current = '';
  let found: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) { current = head[1] ?? ''; continue; }
    const kv = /^([a-z-]+)\s*=\s*(.*)$/.exec(line);
    if (current === section && kv && kv[1] === key) found = (kv[2] ?? '').trim();
  }
  return found;
}

export function parseAvahiConf(text: string): AvahiConfig {
  const name = value(text, 'server', 'host-name') ?? '';
  // avahi's is_yes(): a value starting with y, t or 1 (any case) is true.
  return { hostName: validAvahiName(name) ? name : '', publish: !/^[yt1]/i.test(value(text, 'publish', 'disable-publishing') ?? '') };
}

/**
 * Sets `key=value` in the section: every uncommented line of the key is commented out, then the last line of it
 * (commented or not) holds the new value, or the section's head is followed by it; undefined leaves it commented.
 */
function setValue(text: string, section: string, key: string, val: string | undefined): string {
  const lines = text.replace(/\n$/, '').split('\n');
  const keyLine = new RegExp(`^\\s*#?\\s*${key}\\s*=`);
  let current = '';
  let at = -1;
  let head = -1;
  lines.forEach((raw, i) => {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (h) { current = h[1] ?? ''; if (current === section) head = i; return; }
    if (current !== section || !keyLine.test(raw)) return;
    at = i;
    if (!raw.trim().startsWith('#')) lines[i] = `#${raw.trim()}`;
  });
  if (val !== undefined) {
    if (at >= 0) lines[at] = `${key}=${val}`;
    else if (head >= 0) lines.splice(head + 1, 0, `${key}=${val}`);
    else lines.push('', `[${section}]`, `${key}=${val}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The file with the panel's settings (an empty name or publishing on leave the defaults commented). */
export function withAvahiSettings(text: string, c: AvahiConfig): string {
  const named = setValue(text, 'server', 'host-name', c.hostName || undefined);
  return setValue(named, 'publish', 'disable-publishing', c.publish ? undefined : 'yes');
}
