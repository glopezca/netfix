/** Every screenshot the help shows is captured in both languages, embedded, and small. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docGroups } from '../../src/docs/index.ts';
import { SHOTS } from '../../src/ui/shots-data.ts';

const MAX_BYTES = 80_000;

test('each shot block has its Spanish and English image (run node scripts/shots.mjs, then npm run build)', () => {
  const ids = new Set(docGroups('es-ES').flatMap((g) => g.pages).flatMap((p) => p.blocks).flatMap((b) => (b.kind === 'shot' ? [b.id] : [])));
  assert.ok(ids.has('dns-panel') && ids.has('dns-webgui'), 'the DNS modes come with their screenshots');
  for (const id of ids) for (const lang of ['es', 'en']) assert.ok(SHOTS[`${id}.${lang}`], `missing assets/docs/${id}.${lang}.webp`);
});

test('the embedded screenshots are WebP and small', () => {
  for (const [key, uri] of Object.entries(SHOTS)) {
    assert.match(uri, /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, key);
    assert.ok(uri.length < MAX_BYTES, `${key} is ${uri.length} bytes`);
  }
});
