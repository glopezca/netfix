/** i18n: catalogue parity, placeholders, locale detection and formatting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS } from '../../src/i18n/catalog.ts';
import { detectLocale, localeFromAcceptLanguage, setLocale, getLocale, onLocaleChange, LOCALES } from '../../src/i18n/locale.ts';
import { t, format, fmtEuros, tDynamic } from '../../src/i18n/t.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

test('both languages have the same keys, non-empty messages and the same placeholders', () => {
  const es = CATALOGS['es-ES'];
  const en = CATALOGS['en-GB'];
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(es) as (keyof typeof es)[]) {
    assert.ok(es[key].trim() && en[key].trim(), `empty message ${key}`);
    assert.deepEqual(placeholders(en[key]), placeholders(es[key]), `placeholders of ${key}`);
  }
});

test('t() formats with parameters in the current language', () => {
  assert.equal(getLocale(), 'es-ES');
  assert.equal(t('hint.opened', { name: 'a.json' }), 'Abierto a.json.');
  assert.equal(t('hint.opened', { name: 'a.json' }, 'en-GB'), 'Opened a.json.');
  assert.equal(format('{a} y {b}', { a: 1 }), '1 y {b}', 'a missing parameter stays visible');
  assert.equal(tDynamic('no.such.key'), 'no.such.key');
});

test('setLocale notifies listeners once per real change', () => {
  const seen: string[] = [];
  const off = onLocaleChange((l) => seen.push(l));
  setLocale('en-GB');
  setLocale('en-GB');
  setLocale('es-ES');
  off();
  setLocale('en-GB');
  setLocale('es-ES');
  assert.deepEqual(seen, ['en-GB', 'es-ES']);
});

test('detectLocale: saved choice, then browser languages, then Spanish', () => {
  assert.equal(detectLocale('en-GB', ['es-ES']), 'en-GB');
  assert.equal(detectLocale('xx', ['en-US', 'es']), 'en-GB');
  assert.equal(detectLocale(null, ['es-MX']), 'es-ES');
  assert.equal(detectLocale(null, ['fr-FR', 'de']), 'es-ES');
  assert.deepEqual([...LOCALES], ['es-ES', 'en-GB']);
});

test('Accept-Language picks the best supported language by quality', () => {
  assert.equal(localeFromAcceptLanguage('en-GB,en;q=0.9,es;q=0.8'), 'en-GB');
  assert.equal(localeFromAcceptLanguage('fr;q=1, es;q=0.5, en;q=0.4'), 'es-ES');
  assert.equal(localeFromAcceptLanguage('es;q=0, en;q=0.1'), 'en-GB');
  assert.equal(localeFromAcceptLanguage('de'), null);
  assert.equal(localeFromAcceptLanguage(undefined), null);
});

test('euros are formatted per language', () => {
  assert.equal(fmtEuros(5, 'es-ES').replace(/\s/g, ' '), '5 €');
  assert.equal(fmtEuros(5, 'en-GB'), '€5');
  assert.equal(fmtEuros(7.5, 'en-GB'), '€7.50');
});
