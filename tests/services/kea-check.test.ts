/** kea-dhcp4 -t: kea-dhcp4.conf read as Kea 2.6 does (JSON with comments, keywords per map) and then configured. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkKeaConf } from '../../src/services/kea-check.ts';

const P = '/etc/kea/kea-dhcp4.conf';
const conf = (body: string): string => `{\n  "Dhcp4": {\n${body}\n  }\n}\n`;
const error = (body: string): string | undefined => checkKeaConf(P, conf(body)).error;
/** The subnet list on line 3: its first map starts at column 18. */
const subnets = (list: string): string | undefined => error(`    "subnet4": [ ${list} ]`);
const NET = '{ "id": 1, "subnet": "192.168.10.0/24"';

test('a valid configuration: comments, inherited timers and one line per subnet', () => {
  const r = checkKeaConf(P, conf(`    "interfaces-config": { "interfaces": [ "eth0" ] },
    "lease-database": { "type": "memfile", "persist": true, "name": "/var/lib/kea/kea-leases4.csv" },
    # comentario
    /* otro */
    // y otro
    "valid-lifetime": 3600,
    "renew-timer": 900,
    "subnet4": [
      {
        "id": 1,
        "subnet": "192.168.10.0/24",
        "pools": [ { "pool": "192.168.10.100 - 192.168.10.199" } ],
        "option-data": [ { "name": "routers", "data": "192.168.10.1" }, { "name": "domain-name-servers", "data": "192.168.10.2, 8.8.8.8" } ],
        "reservations": [ { "hw-address": "00:11:22:33:44:55", "ip-address": "192.168.10.50" } ]
      },
      { "id": 2, "subnet": "10.0.0.0/8", "pools": [ { "pool": "10.0.0.0/28" } ], "valid-lifetime": 600, "match-client-id": false }
    ]`));
  assert.equal(r.error, undefined);
  assert.equal(r.ok, true);
  assert.deepEqual(r.log, [
    { level: 'INFO', logger: 'dhcpsrv', message: 'DHCPSRV_CFGMGR_SOCKET_TYPE_DEFAULT "dhcp-socket-type" not specified , using default socket type raw' },
    { level: 'INFO', logger: 'dhcpsrv', message: 'DHCPSRV_CFGMGR_NEW_SUBNET4 a new subnet has been added to configuration: 192.168.10.0/24 with params: t1=900, valid-lifetime=3600' },
    { level: 'INFO', logger: 'dhcpsrv', message: 'DHCPSRV_CFGMGR_NEW_SUBNET4 a new subnet has been added to configuration: 10.0.0.0/8 with params: t1=900, valid-lifetime=600' },
  ]);
});

test('a trailing comma is accepted with a warning', () => {
  const r = checkKeaConf(P, conf('    "valid-lifetime": 3600,'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.log, [{ level: 'WARN', logger: 'dhcp4', message: `DHCP4_CONFIG_SYNTAX_WARNING configuration syntax warning: ${P}:3.27: Extraneous comma. A piece of configuration may have been omitted.` }]);
});

test('syntax errors: the first one, at line.column, as the bison parser of Kea says it', () => {
  const syntax = (m: string): string => `Syntax check failed with: ${P}:${m}`;
  assert.equal(error('    "valid-lifetime": "3600"'), syntax('3.23-28: syntax error, unexpected constant string, expecting integer'));
  assert.equal(error('    "match-client-id": "no"'), syntax('3.24-27: syntax error, unexpected constant string, expecting boolean'));
  assert.equal(error('    "valid-lifetme": 3600'), syntax('3.5-19: got unexpected keyword "valid-lifetme" in Dhcp4 map.'));
  assert.equal(subnets('{ "id": 1, "gateway": "192.168.10.1" }'), syntax('3.29-37: got unexpected keyword "gateway" in subnet4 map.'));
  assert.equal(error('    "valid-lifetime": 3600\n    "subnet4": [ ]'), syntax('4.5-13: syntax error, unexpected subnet4, expecting "," or }'));
  assert.equal(error("    'valid-lifetime': 1"), syntax("3.5: Invalid character: '"));
  assert.equal(error('    "valid-lifetime": 1,\n    "valid-lifetime": 2'), syntax(`4:5: duplicate valid-lifetime entries in Dhcp4 map (previous at ${P}:3:23)`));
  assert.equal(checkKeaConf(P, '{ "Dhcp4": {').error, syntax('1.13: syntax error, unexpected end of file'));
  assert.equal(checkKeaConf(P, '[ ]').error, syntax('1.1: syntax error, unexpected [, expecting {'));
  assert.equal(checkKeaConf(P, '{ "Dhcp4": { } } }').error, syntax('1.18: syntax error, unexpected }, expecting end of file'));
  assert.equal(checkKeaConf(P, '{ "Dhcp6": { } }').error, syntax('1.3-9: got unexpected keyword "Dhcp6" in toplevel map.'));
});

test('DDNS parameters, shared-network-name and less common standard options are accepted', () => {
  assert.equal(checkKeaConf(P, conf('    "ddns-update-on-renew": true,\n    "ddns-ttl-percent": 0.5')).ok, true);
  assert.equal(subnets(`${NET}, "shared-network-name": "aula", "option-data": [ { "name": "v6-only-preferred", "data": "1800" } ] }`), undefined);
});

test('lists nested past the parser stack end with «memory exhausted», not a crash', () => {
  const r = checkKeaConf(P, `{ "Dhcp4": { "user-context": ${'['.repeat(1000)}`);
  assert.equal(r.ok, false);
  assert.equal(r.error, `Syntax check failed with: ${P}:1.229: memory exhausted`);
});

test('a missing file, and a file without Dhcp4', () => {
  assert.deepEqual(checkKeaConf(P, { error: 'file not found' }), { ok: false, log: [], error: `Syntax check failed with: Unable to open file ${P}` });
  assert.equal(checkKeaConf(P, '{ }').error, 'Missing mandatory Dhcp4 element');
});

test('configuration errors of subnets, pools, options and reservations, with the element position', () => {
  const failed = (m: string): string => `Error encountered: ${m}`;
  assert.equal(subnets('{ "id": 1 }'), failed(`subnet configuration failed: mandatory 'subnet' parameter is missing for a subnet being configured (${P}:3:18)`));
  assert.equal(subnets('{ "id": 1, "subnet": "192.168.10.0" }'), failed(`subnet configuration failed: Invalid subnet syntax (prefix/len expected):192.168.10.0 (${P}:3:39)`));
  assert.equal(subnets(`${NET}, "pools": [ { "pool": "192.168.20.10 - 192.168.20.20" } ] }`), failed(`subnet configuration failed: a pool of type V4, with the following address range: 192.168.20.10-192.168.20.20 does not match the prefix of a subnet: 192.168.10.0/24 to which it is being added. (${P}:3:18)`));
  assert.equal(subnets(`${NET}, "pools": [ { "pool": "192.168.10.300 - 192.168.10.20" } ] }`), failed(`Failed to parse pool definition: 192.168.10.300-192.168.10.20 (${P}:3:79)`));
  assert.equal(subnets(`${NET}, "pools": [ { "pool": "192.168.10.50 - 192.168.10.20" } ] }`), failed(`Failed to create pool defined by: 192.168.10.50-192.168.10.20 (${P}:3:79)`));
  assert.equal(subnets(`${NET}, "reservations": [ { "ip-address": "192.168.10.5" } ] }`), failed(`one of the supported identifiers must be specified for host reservation: hw-address duid circuit-id client-id flex-id (${P}:3:76)`));
  assert.equal(subnets(`${NET}, "reservations": [ { "hw-address": "00:11:22:33:44:55", "ip-address": "192.168.20.5" } ] }`), failed("specified reservation '192.168.20.5' is not within the IPv4 subnet '192.168.10.0/24'"));
  assert.equal(subnets(`${NET}, "option-data": [ { "name": "gateway", "data": "192.168.10.1" } ] }`), failed(`definition for the option 'dhcp4.gateway' having code '0' does not exist (${P}:3:85)`));
  assert.equal(subnets(`${NET}, "option-data": [ { "name": "routers", "data": "192.168.10.300" } ] }`), failed(`option data does not match option definition (space: dhcp4, code: 3): Failed to convert string to address '192.168.10.300': Invalid argument (${P}:3:104)`));
  assert.equal(subnets(`${NET} }, { "id": 1, "subnet": "192.168.20.0/24" }`), failed(`ID of the new IPv4 subnet '1' is already in use (${P}:3:60)`));
  assert.equal(subnets(`${NET} }, { "id": 2, "subnet": "192.168.10.0/24" }`), failed(`subnet with the prefix of '192.168.10.0/24' already exists (${P}:3:60)`));
});

test('a configuration error is also logged by the parser that failed', () => {
  const r = checkKeaConf(P, conf('    "subnet4": [ { "id": 1 } ]'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.log.at(-1), { level: 'ERROR', logger: 'dhcp4', message: `DHCP4_PARSER_FAIL failed to create or run parser for configuration element subnet4: subnet configuration failed: mandatory 'subnet' parameter is missing for a subnet being configured (${P}:3:18)` });
});
