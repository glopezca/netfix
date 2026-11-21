/**
 * isc-dhcp-relay's start (S26): its init script sources /etc/default/isc-dhcp-relay and starts dhcrelay with SERVERS and
 * INTERFACES. A file dhcrelay refuses (no servers, a name that is not an address, an interface the host lacks) leaves
 * the unit failed with dhcrelay's error; a good one becomes the model. No reload: Ubuntu's script only restarts.
 */
import type { Server } from '../devices/server.ts';
import type { CheckMode, UnitCheck } from '../devices/unit-checks.ts';
import type { Vfs } from '../bash/vfs.ts';
import { ROOT } from '../bash/vfs.ts';
import { parseRelayDefault, RELAY_DEFAULT } from '../services/relay-conf.ts';

const IDENT = 'isc-dhcp-relay[874]';

export function relayStart(server: Server, fs: Vfs, _mode: CheckMode): UnitCheck {
  let text = '';
  try {
    text = fs.readFile(RELAY_DEFAULT, ROOT); // absent: nothing sourced, so no servers
  } catch { /* the init script skips a missing defaults file */ }
  const r = parseRelayDefault(text, server.portNames().map((p) => server.linuxIfName(p)));
  if ('error' in r) return { ok: false, ident: IDENT, lines: [r.error, 'Starting DHCP relay: dhcrelay failed!'] };
  return { ok: true, ident: IDENT, lines: ['Starting DHCP relay: dhcrelay.'], apply: (s) => ({ ...s, relay: { ...s.relay, servers: r.servers, interfaces: r.interfaces } }) };
}
