/** Registros: SSH first, nftables second (Linux routers only), then Kea, BIND, Apache, Postfix and Dovecot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logUnits } from '../../src/services/units.ts';

test('the units of Registros, in the order of the Services tab', () => {
  assert.deepEqual(logUnits('linuxrouter').map((u) => u.linux), ['ssh', 'nftables', 'kea-dhcp4-server', 'bind9', 'apache2', 'postfix', 'dovecot']);
  assert.deepEqual(logUnits('server').map((u) => u.linux), ['ssh', 'kea-dhcp4-server', 'bind9', 'apache2', 'postfix', 'dovecot']);
});
