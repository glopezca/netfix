/** C5: Netfix's stylesheets style only its mount (.netfix-root), never the page around it (it is mounted without an iframe). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHEETS = ['styles.css', 'web-admin.css', 'docs.css'];
const ROOT = '.netfix-root';

/** The selectors of the top-level rules (comments dropped; at-rules descended into). */
function topSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      const prelude = text.slice(start, i).trim();
      if (depth === 0 || (depth === 1 && out.at(-1)?.startsWith('@'))) out.push(prelude);
      depth++;
      start = i + 1;
    } else if (text[i] === '}') {
      depth--;
      start = i + 1;
    } else if (text[i] === ';') start = i + 1;
  }
  return out.filter((s) => !s.startsWith('@'));
}

test('every top-level rule of the Netfix stylesheets is scoped to .netfix-root', () => {
  for (const sheet of SHEETS) {
    const selectors = topSelectors(readFileSync(new URL(`../../src/ui/${sheet}`, import.meta.url), 'utf8'));
    assert.ok(selectors.length > 0, sheet);
    for (const sel of selectors) {
      for (const part of sel.split(',')) assert.ok(part.trim().endsWith(ROOT), `${sheet}: "${part.trim()}" is not scoped to ${ROOT}`);
    }
  }
});
