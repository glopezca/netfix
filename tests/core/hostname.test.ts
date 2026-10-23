/** Host name derived from the name shown in the workspace: lowercase, no accents, hyphens (RFC 1123). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostnameFromLabel } from '../../src/core/hostname.ts';
import { validHostname } from '../../src/devices/host.ts';

test('the standard form of a label', () => {
  assert.equal(hostnameFromLabel('PC0'), 'pc0');
  assert.equal(hostnameFromLabel('Servidor Web Pública'), 'servidor-web-publica');
  assert.equal(hostnameFromLabel('  Año_2º · Ñandú!! '), 'ano-2o-nandu');
  assert.equal(hostnameFromLabel('router.aula'), 'router-aula', 'one label: the dot is not a domain here');
  assert.equal(hostnameFromLabel('---'), 'equipo');
  assert.equal(hostnameFromLabel('★'), 'equipo');
  const long = hostnameFromLabel('x'.repeat(40) + ' ' + 'y'.repeat(40));
  assert.ok(long.length <= 63 && !long.endsWith('-'));
  for (const l of ['PC0', 'Servidor Web Pública', 'Año_2º', '---', 'a'.repeat(80)]) assert.equal(validHostname(hostnameFromLabel(l)), null, l);
});
