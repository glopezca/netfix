/** The «Donaciones / Donations» tab: suggested amounts, another amount and the PayPal.Me link. */
import { el } from './dom.ts';
import { brandImage } from './brand.ts';
import { t, fmtEuros } from '../i18n/t.ts';
import { parseAmount, paypalMeUrl, SUGGESTED_AMOUNTS, MIN_AMOUNT, MAX_AMOUNT } from '../docs/donate.ts';

const DEFAULT_AMOUNT = 10;
const ERRORS = { empty: 'donate.err.empty', format: 'donate.err.format', range: 'donate.err.range' } as const;

export function donateView(): HTMLElement {
  let amount: number | null = DEFAULT_AMOUNT;
  const otherInput = el('input', { type: 'text', inputmode: 'decimal', class: 'donate-other-input', 'aria-label': t('donate.otherLabel'), placeholder: t('donate.otherPlaceholder'), autocomplete: 'off', hidden: true });
  const error = el('p', { class: 'form-msg is-error', role: 'alert', hidden: true });
  const link = el('a', { class: 'btn btn-primary donate-go', target: '_blank', rel: 'noopener noreferrer' });
  const copy = el('code', { class: 'donate-url' });
  const update = (): void => {
    const url = amount === null ? null : paypalMeUrl(amount);
    link.textContent = amount === null ? t('donate.buttonNone') : t('donate.button', { amount: fmtEuros(amount) });
    if (url) link.setAttribute('href', url);
    else link.removeAttribute('href');
    link.setAttribute('aria-disabled', String(!url));
    copy.textContent = url ?? '';
  };
  const choices = [...SUGGESTED_AMOUNTS.map((a) => [String(a), fmtEuros(a)] as const), ['other', t('donate.other')] as const].map(([value, label]) => {
    const b = el('button', { type: 'button', class: 'donate-amount', 'aria-pressed': String(value === String(DEFAULT_AMOUNT)), 'data-amount': value }, label);
    b.addEventListener('click', () => {
      for (const x of choices) x.setAttribute('aria-pressed', String(x === b));
      otherInput.hidden = value !== 'other';
      error.hidden = true;
      amount = value === 'other' ? null : Number(value);
      if (value === 'other') { otherInput.value = ''; otherInput.focus(); }
      update();
    });
    return b;
  });
  otherInput.addEventListener('input', () => {
    const r = parseAmount(otherInput.value);
    amount = r.ok ? r.amount : null;
    error.hidden = r.ok || r.reason === 'empty';
    error.textContent = r.ok ? '' : t(ERRORS[r.reason], { min: fmtEuros(MIN_AMOUNT), max: fmtEuros(MAX_AMOUNT) });
    update();
  });
  link.addEventListener('click', (e) => { if (!link.getAttribute('href')) e.preventDefault(); });
  update();
  const page = el('article', { class: 'doc-page donate-page', tabindex: '-1' },
    el('header', { class: 'about-hero' },
      brandImage('isologoN', 'about-isologo', ''),
      el('p', { class: 'doc-crumb' }, t('donate.crumb')),
      el('h1', {}, t('donate.title')),
      el('p', { class: 'doc-summary' }, t('donate.lead'))),
    el('p', {}, t('donate.free')),
    el('fieldset', { class: 'donate-box' },
      el('legend', {}, t('donate.choose')),
      el('div', { class: 'donate-amounts', role: 'group' }, ...choices),
      otherInput, error, link),
    el('p', { class: 'muted' }, t('donate.privacy')),
    el('p', { class: 'muted donate-copy' }, t('donate.copy'), ' ', copy),
    el('p', {}, t('donate.thanks')));
  return el('section', { class: 'docs donate', 'aria-label': t('donate.crumb') }, page);
}
