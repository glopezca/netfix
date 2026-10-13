/** Donations: amounts and the PayPal.Me link. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, paypalMeUrl, SUGGESTED_AMOUNTS, PAYPAL_ME_BASE } from '../../src/docs/donate.ts';

test('suggested amounts and their links', () => {
  assert.deepEqual([...SUGGESTED_AMOUNTS], [5, 10, 15, 20]);
  assert.equal(PAYPAL_ME_BASE, 'https://paypal.me/infogerman');
  assert.deepEqual(SUGGESTED_AMOUNTS.map((a) => paypalMeUrl(a)), [5, 10, 15, 20].map((a) => `https://paypal.me/infogerman/${a}EUR`));
});

test('custom amounts accept a decimal comma or point and up to two decimals', () => {
  assert.deepEqual(parseAmount('7'), { ok: true, amount: 7 });
  assert.deepEqual(parseAmount(' 7,5 € '), { ok: true, amount: 7.5 });
  assert.deepEqual(parseAmount('12.25'), { ok: true, amount: 12.25 });
  assert.equal(paypalMeUrl(7.5), 'https://paypal.me/infogerman/7.50EUR');
});

test('invalid amounts never produce a link', () => {
  assert.deepEqual(parseAmount(''), { ok: false, reason: 'empty' });
  for (const bad of ['abc', '5,555', '-5', '1e3', '5.', '0x10', '5/../x', '5EUR?x=1']) assert.deepEqual(parseAmount(bad), { ok: false, reason: 'format' }, bad);
  assert.deepEqual(parseAmount('0'), { ok: false, reason: 'range' });
  assert.deepEqual(parseAmount('0,50'), { ok: false, reason: 'range' });
  assert.deepEqual(parseAmount('1001'), { ok: false, reason: 'range' });
  assert.equal(paypalMeUrl(0), null);
  assert.equal(paypalMeUrl(Number.NaN), null);
  assert.equal(paypalMeUrl(1e9), null);
});
