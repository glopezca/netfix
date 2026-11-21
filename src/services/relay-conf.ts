/**
 * /etc/default/isc-dhcp-relay as Ubuntu's isc-dhcp-relay package installs it: shell assignments (SERVERS, INTERFACES,
 * OPTIONS) that its init script sources before starting dhcrelay. Read at the unit's start (shells/relay-start.ts).
 */
import { formatIp, parseIp } from '../core/ip.ts';

export const RELAY_DEFAULT = '/etc/default/isc-dhcp-relay';

export interface RelaySettings {
  /** The DHCP servers requests go to. */
  readonly servers: readonly number[];
  /** Linux names of the interfaces dhcrelay listens on; empty: all of them. */
  readonly interfaces: readonly string[];
}

export function relayDefaultText(r: RelaySettings): string {
  return `# Defaults for isc-dhcp-relay initscript
# sourced by /etc/init.d/isc-dhcp-relay
# installed at /etc/default/isc-dhcp-relay by the maintainer scripts

#
# This is a POSIX shell fragment
#

# What servers should the DHCP relay forward requests to?
SERVERS="${r.servers.map(formatIp).join(' ')}"

# On what interfaces should the DHCP relay (dhrelay) serve DHCP requests?
INTERFACES="${r.interfaces.join(' ')}"

# Additional options that are passed to the DHCP relay daemon?
OPTIONS=""
`;
}

/** NAME=value, NAME="value" or NAME='value' (no expansion: the fragment only assigns). */
const ASSIGN = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function unquote(raw: string): string | null {
  const v = raw.trim();
  const q = v[0];
  if (q !== '"' && q !== "'") return v.split(/\s+/)[0] ?? '';
  const end = v.indexOf(q, 1);
  return end < 0 ? null : v.slice(1, end);
}

function assignments(text: string): Map<string, string> | { readonly error: string } {
  const vars = new Map<string, string>();
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    const m = ASSIGN.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = unquote(m[2] ?? '');
    if (value === null) return { error: `${RELAY_DEFAULT}: line ${i + 1}: unexpected EOF while looking for matching \`${(m[2] ?? '').trim()[0]}'` };
    vars.set(m[1] ?? '', value);
  }
  return vars;
}

/** What dhcrelay would start with, or its error (the last assignment of each name wins, as in a shell). */
export function parseRelayDefault(text: string, nics: readonly string[]): RelaySettings | { readonly error: string } {
  const vars = assignments(text);
  if ('error' in vars) return vars;
  const words = (name: string): string[] => (vars.get(name) ?? '').split(/\s+/).filter(Boolean);
  const names = words('SERVERS');
  if (names.length === 0) return { error: 'No servers specified.' };
  const servers: number[] = [];
  for (const n of names) {
    const ip = parseIp(n);
    if (ip === null) return { error: `${n}: host unknown.` };
    servers.push(ip);
  }
  const interfaces = words('INTERFACES');
  const missing = interfaces.find((i) => !nics.includes(i));
  if (missing) return { error: `Error getting hardware address for "${missing}": No such device` };
  return { servers, interfaces };
}
