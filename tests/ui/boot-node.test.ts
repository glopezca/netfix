/** S23: an extension's tests (and any tool) may import the `ui` entry outside a page: it publishes the API, starts nothing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('importing ui/boot.ts without a document publishes globalThis.netfix and does not throw', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  await import('../../src/ui/boot.ts');
  assert.equal(typeof (globalThis as { netfix?: { embed?: unknown } }).netfix?.embed, 'function');
});
