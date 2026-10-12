/** The embedded brand images are generated from assets/brand/ and stay in sync with them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BRAND } from '../../src/ui/brand-data.ts';

const root = new URL('../../', import.meta.url);

test('brand-data.ts matches assets/brand (run npm run brand after changing an image)', () => {
  const generated = execFileSync(process.execPath, [new URL('scripts/gen-brand.mjs', root).pathname, '--stdout'], { encoding: 'utf8' });
  assert.equal(generated, readFileSync(new URL('src/ui/brand-data.ts', root), 'utf8'));
});

test('logo, isologos and favicon are small images', () => {
  for (const [name, uri] of Object.entries(BRAND)) {
    assert.match(uri, /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/, name);
    assert.ok(uri.length < 40_000, `${name} is ${uri.length} bytes`);
  }
});
