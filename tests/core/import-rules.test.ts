/** Core/UI boundary rules R1-R3 and R5 of docs/architecture/CORE.md §2, checked on the import statements of src/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

interface Edge { readonly from: string; readonly to: string; readonly spec: string; readonly isType: boolean }

const IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\2/gm;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

const edges: Edge[] = files('src').flatMap((from) =>
  [...readFileSync(from, 'utf8').matchAll(IMPORT)].map((m) => {
    const spec = m[3] ?? '';
    const to = spec.startsWith('.') ? relative('.', join(dirname(from), spec)) : spec;
    return { from, to, spec, isType: m[1] !== undefined };
  }));

const dirOf = (f: string): string => f.split('/')[1] ?? '';
const show = (es: Edge[]): string[] => es.map((e) => `${e.from} -> ${e.spec}`);

test('sanity: the scan sees the known edges', () => {
  assert.ok(edges.some((e) => e.from === 'src/ui/main.ts' && e.to === 'src/classroom/embed.ts'));
});

test('R1: nothing outside src/ui imports src/ui', () => {
  assert.deepEqual(show(edges.filter((e) => dirOf(e.from) !== 'ui' && dirOf(e.to) === 'ui')), []);
});

test('R2: only src/ui (and the package entries, P5) imports src/classroom by value', () => {
  // src/pkg/*.ts re-export the public classroom API (P5, approved 2026-11-15); the engine itself still never does.
  const bad = edges.filter((e) => !e.isType && dirOf(e.to) === 'classroom' && !['ui', 'classroom', 'pkg'].includes(dirOf(e.from)));
  assert.deepEqual(show(bad), []);
});

test('R3: src/core imports no other directory', () => {
  assert.deepEqual(show(edges.filter((e) => dirOf(e.from) === 'core' && e.to.startsWith('src/') && dirOf(e.to) !== 'core')), []);
});

test('R5: no file in src imports packages, node:* or anything outside src', () => {
  assert.deepEqual(show(edges.filter((e) => !e.to.startsWith('src/'))), []);
});
