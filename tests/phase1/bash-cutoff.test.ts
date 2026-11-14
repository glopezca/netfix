/**
 * Characterization: the bash step budget ends an infinite loop by wall-clock deadline (interp.ts tick: Date.now() >
 * deadline), so with Date.now frozen it never ends (DEPENDENCY-MAP.md 5.2). Run in a child process with a hard
 * timeout, because the loop is synchronous and would hang the test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const HARNESS = new URL('../bash/harness.ts', import.meta.url).href;
const CHILD = `Date.now = () => 1_700_000_000_000;
const { runScript } = await import(${JSON.stringify(HARNESS)});
const r = runScript('while :; do :; done');
process.stdout.write('status=' + r.status);`;

test('an infinite bash loop ends even with Date.now frozen', { todo: 'known defect, fixed by PR 1.6' }, () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(r.error, undefined, 'the loop did not end within 5 s');
  assert.match(r.stdout, /^status=124$/);
});
