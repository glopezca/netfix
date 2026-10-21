/** English (UK): bind9 zones (SOA, NS, forward or reverse) and their named-checkzone style checks. */
import type { ZonesKey } from '../es-ES/zones.ts';

export const ZONES_EN: Record<ZonesKey, string> = {
  'zone.err.name': 'Invalid zone name: «{name}» (for example aula.lab or 1.168.192.in-addr.arpa).',
  'zone.err.exists': 'Zone «{name}» already exists.',
  'zone.err.ns': 'A zone needs at least one name server (NS record).',
  'zone.err.nsName': 'Invalid name server: «{name}».',
  'zone.err.reverseName': 'A reverse zone is named after its network backwards, ending in .in-addr.arpa (192.168.1 → 1.168.192.in-addr.arpa).',
  'zone.err.forwardName': '«{name}» is a reverse zone name: choose «Reverse» or use a domain (aula.lab).',
  'zone.err.mname': 'Invalid primary server (SOA): «{name}».',
  'zone.err.rname': 'Invalid responsible mailbox: «{value}» (for example admin@aula.lab).',
  'zone.err.timer': 'SOA timers are whole numbers of seconds (0 to 2147483647).',
  'zone.err.type': 'A {kind} zone does not admit {type} records.',
  'zone.kind.forward': 'forward',
  'zone.kind.reverse': 'reverse',
  'zone.chk.glue': 'Name server {ns} is inside the zone and has no A record (named-checkzone: «NS has no address records»).',
  'zone.chk.cname': '«{name}» has a CNAME and other data: a CNAME cannot share its name with other records.',
  'zone.chk.type': '{type} record of «{name}»: a {kind} zone does not admit it and BIND does not load the zone.',
  'zone.chk.out': '«{name}» is outside zone {zone}: BIND ignores it (out-of-zone data).',
};
