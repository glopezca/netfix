/**
 * Donations through PayPal.Me (serverless): Netfix only builds a link that the user opens; no SDK, no
 * script from PayPal and no data leaves the browser until the user clicks it.
 */

export const PAYPAL_ME_USER = 'infogerman';
export const PAYPAL_ME_BASE = `https://paypal.me/${PAYPAL_ME_USER}`;
export const SUGGESTED_AMOUNTS: readonly number[] = [5, 10, 15, 20];
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 1000;

export type AmountResult = { ok: true; amount: number } | { ok: false; reason: 'empty' | 'format' | 'range' };

/** Parses "7", "7.5", "7,50" (one decimal separator, up to two decimals) within MIN_AMOUNT..MAX_AMOUNT. */
export function parseAmount(text: string): AmountResult {
  const s = text.trim().replace(/\s*€\s*/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(s)) return { ok: false, reason: 'format' };
  const amount = Number(s.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) return { ok: false, reason: 'range' };
  return { ok: true, amount };
}

/** https://paypal.me/infogerman/10EUR (decimals as 7.50); null for an invalid amount. */
export function paypalMeUrl(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) return null;
  const cents = Math.round(amount * 100);
  const text = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return `${PAYPAL_ME_BASE}/${text}EUR`;
}
