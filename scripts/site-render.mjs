// Renders the landing page from its template and a strings catalogue (pure: no file access, for the tests).
// {{key}} is a catalogue string, {{@name}} a value computed here; everything is HTML-escaped except the
// amount buttons, which are built here from escaped parts.

export const SITE_URL = 'https://glopezca.github.io/Netfix/';
export const REPO_URL = 'https://github.com/glopezca/netfix';
export const PAYPAL_URL = 'https://paypal.me/infogerman';
export const AMOUNTS = [5, 10, 15, 20];
/** Each language: its catalogue, its folder under the site and the other language. */
export const LOCALES = {
  'en-GB': { code: 'en', dir: '', other: 'es-ES' },
  'es-ES': { code: 'es', dir: 'es/', other: 'en-GB' },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Euros as written in each language: sign first in British English, after a space in Spanish. */
export function euros(amount, lang) {
  return lang === 'es-ES' ? `${amount} €` : `€${amount}`;
}

function amountButtons(strings, lang) {
  return AMOUNTS.map((n) => {
    const label = strings['donate.amountLabel'].replace('{amount}', euros(n, lang));
    return `            <a class="btn btn-primary" href="${escapeHtml(`${PAYPAL_URL}/${n}EUR`)}" aria-label="${escapeHtml(label)}">${escapeHtml(euros(n, lang))}</a>`;
  }).join('\n');
}

/** Values of {{@name}} for one language. */
export function pageValues(lang, strings) {
  const loc = LOCALES[lang];
  if (!loc) throw new Error(`Unknown language ${lang}`);
  const other = LOCALES[loc.other];
  const root = loc.dir ? '../' : '';
  return {
    lang, code: loc.code, root,
    otherLang: loc.other,
    home: './',
    otherHome: `${root}${other.dir}` || './',
    canonical: `${SITE_URL}${loc.dir}`,
    urlEn: `${SITE_URL}${LOCALES['en-GB'].dir}`,
    urlEs: `${SITE_URL}${LOCALES['es-ES'].dir}`,
    ogImage: `${SITE_URL}img/workspace-${loc.code}.webp`,
    app: `${root}app/`,
    offline: `${root}app/netfix.html`,
    repo: REPO_URL,
    paypal: PAYPAL_URL,
    amounts: { raw: amountButtons(strings, lang) },
  };
}

/** The page; an unknown {{key}} fails the build rather than publishing a gap. */
export function renderPage(template, strings, lang) {
  const values = pageValues(lang, strings);
  return template.replace(/\{\{(@?)([\w.-]+)\}\}/g, (_m, at, key) => {
    const v = at ? values[key] : strings[key];
    if (v === undefined) throw new Error(`Missing ${at}${key} for ${lang}`);
    return typeof v === 'object' ? v.raw : escapeHtml(v);
  });
}
