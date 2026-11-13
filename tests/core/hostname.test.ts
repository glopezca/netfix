/** Host name derived from the name shown in the workspace: case kept, no accents, hyphens (systemd's rules). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostnameFromLabel } from '../../src/core/hostname.ts';
import { validHostname } from '../../src/devices/host.ts';

test('the standard form of a label: case kept, as Ubuntu keeps it (systemd LDH rules)', () => {
  assert.equal(hostnameFromLabel('PC0'), 'PC0');
  assert.equal(hostnameFromLabel('Servidor Web Pública'), 'Servidor-Web-Publica');
  assert.equal(hostnameFromLabel('  Año_2º · Ñandú!! '), 'Ano-2o-Nandu');
  assert.equal(hostnameFromLabel('router.aula'), 'router.aula', 'dots stay: an FQDN is a valid static name');
  assert.equal(hostnameFromLabel('a..b. -c-'), 'a.b.c', 'no empty labels, no hyphen at the edge of a label');
  assert.equal(hostnameFromLabel('---'), 'equipo');
  assert.equal(hostnameFromLabel('★'), 'equipo');
  const long = hostnameFromLabel('x'.repeat(40) + ' ' + 'y'.repeat(40));
  assert.ok(long.length <= 64 && !long.endsWith('-'), 'HOST_NAME_MAX');
  for (const l of ['PC0', 'Servidor Web Pública', 'Año_2º', '---', 'a'.repeat(80), 'a..b. -c-']) assert.equal(validHostname(hostnameFromLabel(l)), null, l);
});

test('validHostname follows systemd: letters of either case, digits and hyphens; labels without a hyphen at the edge; 64 at most', () => {
  for (const ok of ['PC0', 'Web-01', 'srv.Empresa.local', 'a'.repeat(64)]) assert.equal(validHostname(ok), null, ok);
  for (const bad of ['', '-pc', 'pc-', 'a..b', 'pc_1', 'año', 'a b', 'a.-b', 'a'.repeat(65)]) assert.notEqual(validHostname(bad), null, bad);
});


test('a name with dots announces its first label (avahi, LLMNR, NetBIOS)', async () => {
  const { shortHostname } = await import('../../src/core/hostname.ts');
  assert.equal(shortHostname('srv.aula.lab'), 'srv');
  assert.equal(shortHostname('PC0'), 'PC0');
  const { ownNames } = await import('../../src/net/netbios.ts');
  const { Topology } = await import('../../src/net/topology.ts');
  const p = new Topology().add('pc', 0, 0, { label: 'srv.aula.lab' });
  assert.equal(ownNames(p.device as never)[0]?.name, 'SRV');
});
