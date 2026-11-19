/** R7 / task 1.8: `ui/main.ts` only defines; `ui/boot.ts` publishes `globalThis.netfix` and starts the page. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('importing ui/main.ts has no effects: no global API and no start (a host can mount Netfix without an iframe)', async () => {
  const main = await import('../../src/ui/main.ts');
  assert.equal(Object.hasOwn(globalThis, 'netfix'), false);
  assert.deepEqual(Object.keys(main.NETFIX_API).sort(), ['code', 'embed', 'evaluate', 'lab']);
  assert.equal(typeof main.startStandalone, 'function');
});
