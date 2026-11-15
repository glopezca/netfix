/** `Evaluation.runtime` says which engine, schema and grading semantics produced a mark. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, EVALUATION_VERSION } from '../../src/classroom/evaluate.ts';
import { FILE_VERSION } from '../../src/net/topology-file.ts';
import { EXAMPLES } from '../../src/net/examples.ts';

test('evaluate attaches runtime info matching package.json and FILE_VERSION', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const ex = EXAMPLES[0];
  assert.ok(ex);
  const ev = evaluate(ex.build().toJSON(), []);
  assert.deepEqual(ev.runtime, { engineVersion: pkg.version, topologySchemaVersion: FILE_VERSION, evaluationVersion: EVALUATION_VERSION });
});
