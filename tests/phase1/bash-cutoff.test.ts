/**
 * An infinite bash loop ends by a step cap, not only by wall-clock deadline (interp.ts tick), so with Date.now
 * frozen it still ends with status 124 (DEPENDENCY-MAP.md 5.2). The harness lets the abort signal escape; its code
 * is the status. Run in a child process with a hard timeout, because a regression would hang the test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const HARNESS = new URL('../bash/harness.ts', import.meta.url).href;
const CHILD = `Date.now = () => 1_700_000_000_000;
const { runScript } = await import(${JSON.stringify(HARNESS)});
try { runScript('while :; do :; done'); } catch (e) { process.stdout.write('status=' + e.code); }`;

test('an infinite bash loop ends even with Date.now frozen', () => {
  // A hang never ends; 15 s leaves room for the whole suite running in parallel (about 1 s alone, over 3 s under load).
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL' });
  assert.equal(r.error, undefined, 'the loop did not end within 15 s');
  assert.match(r.stdout, /^status=124$/);
});
