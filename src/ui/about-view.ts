/** The «Acerca de» tab: version, authorship, licences and attributions (generated from the repository root). */
import { el } from './dom.ts';
import { docBlock } from './doc-blocks.ts';
import { aboutInfo } from '../docs/about.ts';

const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

export function aboutView(): HTMLElement {
  const a = aboutInfo();
  const link = (href: string, text: string): HTMLElement => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const facts = el('dl', { class: 'about-facts' },
    el('dt', {}, 'Versión'), el('dd', {}, el('span', { class: 'about-version' }, a.version)),
    el('dt', {}, 'Autoría'), el('dd', {}, a.author || '—'),
    el('dt', {}, 'Repositorio'), el('dd', {}, link(a.repository, a.repository.replace(/^https:\/\//, ''))),
    el('dt', {}, 'Licencia del código'), el('dd', {}, link(LICENSE_URL, a.license)),
    el('dt', {}, 'Ejecución'), el('dd', {}, 'Todo funciona en tu navegador: sin servidor, sin dependencias y sin enviar datos.'));
  const hero = el('header', { class: 'about-hero' },
    el('p', { class: 'doc-crumb' }, 'Acerca de'),
    el('h1', {}, a.name, ' ', el('small', {}, `v${a.version}`)),
    el('p', { class: 'doc-summary' }, a.description), facts);
  const license = el('section', { class: 'about-license', 'aria-label': 'Licencia y atribuciones' },
    el('h2', {}, 'Licencia y atribuciones'),
    el('p', { class: 'muted' }, 'Contenido de LICENSE.md, en la raíz del repositorio.'),
    ...a.blocks.map((b) => docBlock(b, a.fileBase)));
  return el('section', { class: 'docs about', 'aria-label': 'Acerca de netsim' }, el('article', { class: 'doc-page about-page', tabindex: '-1' }, hero, license));
}
