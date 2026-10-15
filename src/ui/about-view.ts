/** The «Acerca de» tab: version, authorship, licences and attributions (generated from the repository root). */
import { el } from './dom.ts';
import { docBlock } from './doc-blocks.ts';
import { aboutInfo } from '../docs/about.ts';
import { brandImage } from './brand.ts';
import { t } from '../i18n/t.ts';

const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

export function aboutView(): HTMLElement {
  const a = aboutInfo();
  const link = (href: string, text: string): HTMLElement => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const facts = el('dl', { class: 'about-facts' },
    el('dt', {}, t('about.version')), el('dd', {}, el('span', { class: 'about-version' }, a.version)),
    el('dt', {}, t('about.author')), el('dd', {}, a.author || '—'),
    el('dt', {}, t('about.repo')), el('dd', {}, link(a.repository, a.repository.replace(/^https:\/\//, ''))),
    el('dt', {}, t('about.license')), el('dd', {}, link(LICENSE_URL, a.license)),
    el('dt', {}, t('about.runs')), el('dd', {}, t('about.runsText')));
  const hero = el('header', { class: 'about-hero' },
    brandImage('isologoN', 'about-isologo', ''),
    el('p', { class: 'doc-crumb' }, t('about.crumb')),
    brandImage('logo', 'about-logo', a.name),
    el('h1', { class: 'visually-hidden' }, a.name),
    el('p', { class: 'about-release' }, t('about.release', { version: a.version })),
    el('p', { class: 'doc-summary' }, t('about.description')), facts);
  const license = el('section', { class: 'about-license', 'aria-label': t('about.licenseTitle') },
    el('h2', {}, t('about.licenseTitle')),
    el('p', { class: 'muted' }, t('about.licenseFrom')),
    ...a.blocks.map((b) => docBlock(b, a.fileBase)));
  return el('section', { class: 'docs about', 'aria-label': t('about.label') }, el('article', { class: 'doc-page about-page', tabindex: '-1' }, hero, license));
}
