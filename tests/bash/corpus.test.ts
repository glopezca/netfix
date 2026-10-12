/**
 * Conformance corpus: every tests/bash/corpus/*.sh must print exactly what GNU bash printed
 * (outputs generated with scripts/gen-bash-corpus.sh; *.manual.sh have hand-written outputs
 * for bash 5.3 features newer than the reference bash).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runScript } from './harness.ts';

const DIR = new URL('./corpus/', import.meta.url);

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sh')).sort()) {
  test(`corpus ${file}`, () => {
    const src = readFileSync(new URL(file, DIR), 'utf8');
    const expected = readFileSync(new URL(file.replace(/\.sh$/, '.out'), DIR), 'utf8');
    const r = runScript(src, { args: ['a1', 'a2'] });
    assert.equal(`${r.out}[status ${r.status}]\n`, expected);
  });
}
