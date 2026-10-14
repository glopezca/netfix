/**
 * Literal guard: the interface (src/ui) and the simulated web pages (src/web) take their texts from the
 * catalogues. A Spanish literal there would stay in Spanish for English users.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIRS = ['src/ui', 'src/web', 'src/clients'];
const SKIP_FILES = new Set(['src/ui/brand-data.ts']);
const LITERAL = /(['`])((?:(?!\1)[^\\]|\\.)*?)\1/g;
const SPANISH_CHARS = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
const SPANISH_WORDS = /^(Guardar|Eliminar|Borrar|Añadir|Nombre|Usuario|Contraseña|Servicios?|Equipo|Correo|Activado|Desactivado|Puerto|Tipo|Valor|Dominio|Registros|Estado|Aplicar|Cancelar|Cerrar|Abrir|Enviar|Recibir|Buscar|Navegador|Ninguna?|Ninguno)$/;
/** Literals that are data, not interface text (example names typed by the user, Cisco/Linux output). */
const ALLOWED = new Set(['www  ·  @  ·  *  ·  host.otro.dom.', 'srv  ·  @  ·  srv.otro.dom.']);

function offenders(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*\*|import )/.test(line)) return;
    for (const m of line.matchAll(LITERAL)) {
      const s = m[2] ?? '';
      if (ALLOWED.has(s)) continue;
      if (SPANISH_CHARS.test(s.replace(/\$\{[^}]*\}/g, '')) || SPANISH_WORDS.test(s.trim())) out.push(`${file}:${i + 1}: ${s.slice(0, 80)}`);
    }
  });
  return out;
}

test('no Spanish literals in src/ui, src/web and src/clients: every text goes through t()', () => {
  const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`)).filter((f) => !SKIP_FILES.has(f));
  assert.deepEqual(files.flatMap(offenders), []);
});

test('no key is defined twice across the Spanish catalogue files', () => {
  const dir = 'src/i18n/es-ES';
  const keys = readdirSync(dir).flatMap((f) => [...readFileSync(`${dir}/${f}`, 'utf8').matchAll(/^ {2}'([\w.-]+)':/gm)].map((m) => m[1] ?? ''));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});
