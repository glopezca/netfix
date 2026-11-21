/** /etc/default/isc-dhcp-relay as Ubuntu installs it: SERVERS, INTERFACES and OPTIONS, shell assignments the init script sources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRelayDefault, relayDefaultText, RELAY_DEFAULT } from '../../src/services/relay-conf.ts';
import { parseIp } from '../../src/core/ip.ts';

const NICS = ['eth0', 'eth1', 'eth2'];
const ip = (s: string): number => parseIp(s) ?? 0;

test('the generated file reads back as the model; Ubuntu\'s default is empty', () => {
  assert.equal(RELAY_DEFAULT, '/etc/default/isc-dhcp-relay');
  const empty = relayDefaultText({ servers: [], interfaces: [] });
  assert.match(empty, /^SERVERS=""$/m);
  assert.match(empty, /^INTERFACES=""$/m);
  const text = relayDefaultText({ servers: [ip('10.0.0.1')], interfaces: ['eth1', 'eth0'] });
  assert.match(text, /^SERVERS="10\.0\.0\.1"$/m);
  assert.deepEqual(parseRelayDefault(text, NICS), { servers: [ip('10.0.0.1')], interfaces: ['eth1', 'eth0'] });
});

test('hand edits: quotes or none, comments, several servers, the last assignment wins', () => {
  const r = parseRelayDefault('# comment\nSERVERS=10.0.0.1\nSERVERS="10.0.0.1 10.0.0.2"\nINTERFACES=\'eth1\'\nOPTIONS="-a"\n', NICS);
  assert.deepEqual(r, { servers: [ip('10.0.0.1'), ip('10.0.0.2')], interfaces: ['eth1'] });
});

test('what dhcrelay refuses: no servers, a server that is not an address, an interface the router does not have', () => {
  assert.deepEqual(parseRelayDefault('SERVERS=""\nINTERFACES="eth1"\n', NICS), { error: 'No servers specified.' });
  assert.deepEqual(parseRelayDefault('SERVERS="dhcp.local"\n', NICS), { error: 'dhcp.local: host unknown.' });
  assert.deepEqual(parseRelayDefault('SERVERS="10.0.0.1"\nINTERFACES="eth9"\n', NICS), { error: 'Error getting hardware address for "eth9": No such device' });
  assert.deepEqual(parseRelayDefault('SERVERS="10.0.0.1\n', NICS), { error: '/etc/default/isc-dhcp-relay: line 1: unexpected EOF while looking for matching `"\'' });
});

test('repeated servers and interfaces count once; more than the lab can save is refused at the start', () => {
  assert.deepEqual(parseRelayDefault('SERVERS="10.0.0.1 10.0.0.1"\nINTERFACES="eth1 eth1"\n', NICS), { servers: [ip('10.0.0.1')], interfaces: ['eth1'] });
  const nine = Array.from({ length: 9 }, (_, i) => `10.0.0.${i + 1}`).join(' ');
  assert.deepEqual(parseRelayDefault(`SERVERS="${nine}"\n`, NICS), { error: 'Netfix: at most 8 servers in SERVERS' });
});
