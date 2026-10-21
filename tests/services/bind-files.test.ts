/** /etc/bind as Ubuntu has it, generated from the zones: named.conf.local, the zone files and the automatic reverse zones. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindFiles } from '../../src/services/bind-files.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import type { DnsSettings } from '../../src/services/config.ts';

const dns: DnsSettings = {
  enabled: true,
  zones: [{ ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [
    { name: 'ns', type: 'A', value: '192.168.1.2', ttl: 86400 },
    { name: 'www', type: 'A', value: '192.168.1.10', ttl: 86400 },
    { name: '@', type: 'MX', value: 'ns', priority: 10, ttl: 86400 },
  ] }],
};

test('named.conf.local lists the hand-made zones and the automatic reverse zone', () => {
  const local = bindFiles(dns).get('/etc/bind/named.conf.local') ?? '';
  assert.match(local, /zone "aula\.lab" \{\n\ttype master;\n\tfile "\/etc\/bind\/db\.aula\.lab";\n\};/);
  assert.match(local, /\/\/ Zona inversa automática[^\n]*\nzone "1\.168\.192\.in-addr\.arpa" \{\n\ttype master;\n\tfile "\/etc\/bind\/db\.1\.168\.192\.in-addr\.arpa";/);
  assert.match(bindFiles(dns).get('/etc/bind/named.conf') ?? '', /include "\/etc\/bind\/named\.conf\.local";/);
});

test('a zone file starts with the SOA, then the NS list, then the records', () => {
  const db = bindFiles(dns).get('/etc/bind/db.aula.lab') ?? '';
  const lines = db.split('\n');
  assert.equal(lines[2], '$ORIGIN aula.lab.');
  assert.match(lines[3] ?? '', /^@\s+IN\s+SOA\s+ns\.aula\.lab\. admin\.aula\.lab\. \($/);
  assert.match(db, /\d{10}\s+; serie\n\s+604800\s+; refresh\n\s+86400\s+; retry\n\s+2419200\s+; expire\n\s+3600\s+\); TTL negativo\n@\s+IN  NS    ns\.aula\.lab\.\nns\s+86400\s+IN  A\s+192\.168\.1\.2/);
  assert.match(db, /@\s+86400\s+IN  MX\s+10 ns/);
  const rev = bindFiles(dns).get('/etc/bind/db.1.168.192.in-addr.arpa') ?? '';
  assert.match(rev, /^; Zona inversa 1\.168\.192\.in-addr\.arpa — generada automáticamente/);
  assert.match(rev, /\n2\s+86400\s+IN  PTR\s+ns\.aula\.lab\.\n10\s+86400\s+IN  PTR\s+www\.aula\.lab\.\n/);
});
