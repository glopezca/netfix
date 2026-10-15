/** Landing page for GitHub Pages: both languages complete, links in place and nothing left unrendered. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { renderPage, escapeHtml, euros, LOCALES, REPO_URL, PAYPAL_URL, AMOUNTS } from '../../scripts/site-render.mjs';

const template = readFileSync('site/index.template.html', 'utf8');
const catalogue = (lang: string): Record<string, string> => JSON.parse(readFileSync(`site/i18n/${lang}.json`, 'utf8')) as Record<string, string>;
const en = catalogue('en-GB');
const es = catalogue('es-ES');

test('both languages have the same keys, none empty, and the template uses all of them', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) assert.ok(v.trim(), k);
  const used = new Set([...template.matchAll(/\{\{([\w.-]+)\}\}/g)].map((m) => m[1]));
  const unused = Object.keys(en).filter((k) => !used.has(k) && k !== 'donate.amountLabel');
  assert.deepEqual(unused, []);
});

test('each page is fully rendered, in its language, with links to the app, the repository and PayPal', () => {
  for (const [lang, strings] of [['en-GB', en], ['es-ES', es]] as const) {
    const html = renderPage(template, strings, lang);
    assert.doesNotMatch(html, /\{\{|\}\}/, lang);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    const root = LOCALES[lang].dir ? '../' : '';
    assert.ok(html.includes(`href="${root}app/"`), `${lang}: app link`);
    assert.ok(html.includes(`href="${REPO_URL}"`), `${lang}: repository link`);
    for (const n of AMOUNTS) assert.ok(html.includes(`href="${PAYPAL_URL}/${n}EUR"`), `${lang}: ${n} EUR`);
    assert.ok(html.includes(`href="${PAYPAL_URL}"`), `${lang}: other amount`);
    assert.match(html, /hreflang="en-GB"[\s\S]*hreflang="es-ES"/);
  }
});

test('the language switch points at the other page', () => {
  assert.match(renderPage(template, en, 'en-GB'), /class="lang" href="es\/" hreflang="es-ES"/);
  assert.match(renderPage(template, es, 'es-ES'), /class="lang" href="\.\.\/" hreflang="en-GB"/);
});

test('catalogue text is escaped and a missing key fails the build', () => {
  const html = renderPage(template, { ...en, 'hero.title': '<script>x</script>' }, 'en-GB');
  assert.ok(!html.includes('<script>x'));
  assert.equal(escapeHtml(`a&"'<>`), 'a&amp;&quot;&#39;&lt;&gt;');
  const { 'faq.title': _gone, ...partial } = en;
  assert.throws(() => renderPage(template, partial, 'en-GB'), /faq\.title/);
  assert.throws(() => renderPage(template, en, 'fr-FR'), /Unknown language/);
});

test('amounts are written as each language writes euros', () => {
  assert.equal(euros(5, 'en-GB'), '€5');
  assert.equal(euros(5, 'es-ES'), '5 €');
});

test('every local image, icon and stylesheet of the pages exists in the site sources', () => {
  const sources: Record<string, string> = { 'site.css': 'site/site.css', 'logo.webp': 'assets/brand/logo.webp', 'isologo-n.webp': 'assets/brand/isologo-n.webp', 'favicon.png': 'assets/brand/favicon.png', 'apple-touch-icon.png': 'assets/brand/apple-touch-icon.png' };
  for (const [lang, strings] of [['en-GB', en], ['es-ES', es]] as const) {
    const html = renderPage(template, strings, lang);
    const refs = [...html.matchAll(/(?:src|href)="(?:\.\.\/)?((?:img\/)?[\w.-]+\.(?:webp|png|css))"/g)].map((m) => m[1] ?? '');
    assert.ok(refs.length >= 8, lang);
    for (const r of refs) assert.ok(existsSync(sources[r] ?? `site/${r}`), `${lang}: ${r}`);
  }
});
