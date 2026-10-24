import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePool, ptExclusions, ptPoolToIos } from '../../src/services/dhcp-pt.ts';
import { validateRecord, answerQuery, zonesOf } from '../../src/services/dns-service.ts';
import { validateFileName, findFile, serveHttp, escapeHtml } from '../../src/services/http-service.ts';
import { splitAddress, Mailboxes } from '../../src/services/mail-service.ts';
import { findUnit, setUnitActive, unitActive, openPorts } from '../../src/services/units.ts';
import { servicesFromJson, servicesToJson, mailboxesFromJson } from '../../src/services/persist.ts';
import { defaultServices } from '../../src/services/config.ts';
import type { PtDhcpPool } from '../../src/services/config.ts';
import { parseUrl } from '../../src/shells/net-tools.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s)!;
const POOL: PtDhcpPool = { name: 'p', start: ip('10.0.0.100'), prefix: 24, maxUsers: 10, gateway: ip('10.0.0.1'), leaseMinutes: 90, tftp: ip('10.0.0.5'), reservations: [] };

test('PT pool validation and mapping to the IOS engine', () => {
  assert.equal(validatePool(POOL, []), null);
  assert.match(validatePool({ ...POOL, name: 'mal nombre' }, [])!, /nombre/);
  assert.match(validatePool(POOL, [POOL])!, /Ya existe/);
  assert.match(validatePool({ ...POOL, prefix: 31 }, [])!, /máscara/);
  assert.match(validatePool({ ...POOL, start: ip('10.0.0.0') }, [])!, /no es una dirección de host/);
  assert.match(validatePool({ ...POOL, maxUsers: 0 }, [])!, /al menos 1/);
  assert.match(validatePool({ ...POOL, gateway: ip('10.1.0.1') }, [])!, /misma subred/);
  assert.match(validatePool({ ...POOL, name: 'q' }, [POOL])!, /Ya hay un pool para esa subred/);
  assert.match(validatePool({ ...POOL, reservations: [{ ip: ip('10.9.9.9'), mac: 'aabbccddeeff' }] }, [])!, /no está en la subred/);
  assert.deepEqual(ptExclusions(POOL).map((r) => `${formatIp(r.low)}-${formatIp(r.high)}`), ['10.0.0.1-10.0.0.99', '10.0.0.110-10.0.0.254']);
  const ios = ptPoolToIos(POOL);
  assert.deepEqual(ios.lease, { days: 0, hours: 1, minutes: 30 });
  assert.equal(ios.options[0]?.code, 150);
});

test('DNS record validation, zones, REFUSED and NODATA', () => {
  assert.equal(validateRecord({ name: 'www.lab', type: 'A', value: '1.2.3.4', ttl: 60 }), null);
  assert.match(validateRecord({ name: 'bad name', type: 'A', value: '1.2.3.4', ttl: 60 })!, /Nombre no válido/);
  assert.match(validateRecord({ name: 'a.lab', type: 'A', value: 'host', ttl: 60 })!, /IPv4/);
  assert.match(validateRecord({ name: 'a.lab', type: 'CNAME', value: 'x y', ttl: 60 })!, /nombre de host/);
  assert.match(validateRecord({ name: 'lab', type: 'MX', value: 'mx.lab', ttl: 60 })!, /prioridad/);
  assert.match(validateRecord({ name: 'lab', type: 'TXT', value: ' ', ttl: 60 })!, /vacío/);
  const recs = [{ name: 'www.aula.lab', type: 'A' as const, value: '10.0.0.1', ttl: 60 }];
  assert.deepEqual(zonesOf(recs), ['aula.lab']);
  const nodata = answerQuery({ id: 1, response: false, qname: 'www.aula.lab', qtype: 'MX' }, recs);
  assert.equal(nodata.rcode, 'NOERROR');
  assert.equal(nodata.answers?.length, 0);
  assert.equal(answerQuery({ id: 1, response: false, qname: 'x.org', qtype: 'A' }, recs).rcode, 'REFUSED');
  assert.equal(answerQuery({ id: 1, response: false, qname: '9.9.9.9.in-addr.arpa', qtype: 'PTR' }, recs).rcode, 'NXDOMAIN');
});

test('HTTP helpers', () => {
  assert.equal(validateFileName('docs/guia.html', []), null);
  assert.match(validateFileName('con espacio.html', [])!, /sin espacios/);
  assert.match(validateFileName('index.html', [{ name: 'INDEX.html', content: '' }])!, /Ya existe/);
  const files = [{ name: 'index.html', content: 'hi' }, { name: 'docs/index.html', content: 'docs' }, { name: 'a.css', content: 'x' }, { name: 'd.json', content: '{}' }, { name: 'n.txt', content: 't' }];
  assert.equal(findFile(files, '/docs/')?.content, 'docs');
  assert.equal(findFile(files, '/?q=1')?.content, 'hi');
  const req = { app: 'HTTP' as const, kind: 'request' as const, method: 'HEAD' as const, host: 'h', path: '/a.css' };
  assert.equal(serveHttp(files, req).contentType, 'text/css');
  assert.equal(serveHttp(files, req).body, '');
  assert.equal(serveHttp(files, { ...req, path: '/d.json', method: 'GET' }).contentType, 'application/json');
  assert.match(serveHttp(files, { ...req, path: '/n.txt', method: 'GET' }).contentType, /text\/plain/);
  assert.equal(serveHttp(files, { ...req, path: '/x' }).body, '');
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('mail helpers, units and service toggles', () => {
  assert.deepEqual(splitAddress(' Ana@Aula.LAB '), { user: 'ana', domain: 'aula.lab' });
  assert.equal(splitAddress('nope'), null);
  const boxes = new Mailboxes();
  boxes.deliver('Ana', { from: 'a@b', to: ['ana@b'], subject: 's', body: 'b', date: 1 });
  assert.equal(boxes.count(), 1);
  assert.equal(findUnit('named.service')?.linux, 'bind9');
  assert.equal(findUnit('W3SVC')?.id, 'http');
  assert.equal(findUnit('nada'), undefined);
  let s = defaultServices();
  for (const id of ['dhcp', 'dns', 'http', 'smtp', 'mailbox', 'ssh'] as const) {
    s = setUnitActive(s, id, true);
    assert.equal(unitActive(s, id), true);
  }
  s = { ...s, mail: { ...s.mail, imap: false } };
  assert.ok(!openPorts(s).some((p) => p.port === 143));
  assert.ok(openPorts(s).some((p) => p.port === 110));
});

test('services JSON validation rejects malformed data', () => {
  const s = defaultServices();
  assert.deepEqual(servicesFromJson(JSON.parse(JSON.stringify(servicesToJson(s)))).http.files.length, 2);
  assert.deepEqual(servicesFromJson(undefined).http.enabled, true);
  assert.throws(() => servicesFromJson('x'), /no válidos/);
  assert.throws(() => servicesFromJson({ dhcp: { pools: [{ name: 'p', start: '10.0.0.1', prefix: 99, maxUsers: 1 }] } }), /máscara/);
  assert.throws(() => servicesFromJson({ dhcp: { pools: [{ name: 'p', prefix: 24, maxUsers: 1 }] } }), /sin dirección IP inicial/);
  assert.throws(() => servicesFromJson({ dhcp: { pools: [{ name: 'p', start: '10.0.0.1', prefix: 24, maxUsers: 1, reservations: [{ ip: '10.0.0.2', mac: 'zz' }] }] } }), /incompleta/);
  assert.throws(() => servicesFromJson({ dns: { records: [{ name: 'a', type: 'SRV', value: 'x' }] } }), /Registro DNS/);
  assert.throws(() => servicesFromJson({ mail: { users: [{ name: 'a' }] } }), /contraseña/);
  assert.throws(() => servicesFromJson({ http: { files: 'x' } }), /Lista no válida/);
  assert.throws(() => mailboxesFromJson({ ana: [{ from: 'a' }] }), /no válido/);
  assert.deepEqual(mailboxesFromJson(undefined), {});
});

test('URL parsing for curl and the browser', () => {
  assert.deepEqual(parseUrl('http://www.lab:8080/a?b'), { host: 'www.lab', port: 8080, path: '/a?b' });
  assert.deepEqual(parseUrl('www.lab'), { host: 'www.lab', port: 80, path: '/' });
  assert.equal(parseUrl('https://www.lab'), null);
  assert.equal(parseUrl('a b'), null);
});
