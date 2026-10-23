/**
 * Servicios → DNS → «Nombres públicos»: the response policy zone (rpz.publicos) with the list of public names. The
 * switch, the file and «Aplicar» go together (systemctl restart bind9); «Restaurar» brings back the initial list.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { button, message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import { commit } from './dns-commit.ts';
import { rpzEntries, rpzFile, setPublicNames } from '../services/dns-rpz.ts';

const FILE_ROWS = '12';

export function publicNamesBlock(server: Server, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const dns = server.services.dns;
  const enabled = el('input', { type: 'checkbox', checked: dns.publicNames?.enabled === true });
  const file = el('textarea', { class: 'code-editor', rows: FILE_ROWS, spellcheck: 'false', wrap: 'off', 'aria-label': t('rpz.file', { count: rpzEntries(dns).length }) });
  file.value = rpzFile(dns);
  const apply = (list: string): void => {
    if (commit(server, app, msg, setPublicNames(server.services.dns, enabled.checked, list), true)) msg.ok(t(list === 'initial' ? 'rpz.restored' : 'rpz.saved'));
  };
  return el('section', { class: 'rpz-block' },
    el('h3', {}, t('rpz.title')),
    el('p', { class: 'muted' }, t('rpz.desc')),
    el('label', { class: 'check' }, enabled, ` ${t('rpz.enable')}`),
    dns.recursion === true ? null : el('p', { class: 'field-hint' }, t('rpz.needsRecursion')),
    el('h4', { class: 'mono' }, t('rpz.file', { count: rpzEntries(dns).length })),
    file,
    el('div', { class: 'actions' }, button(t('rpz.apply'), () => apply(file.value)), button(t('rpz.initial'), () => apply('initial'), 'btn btn-quiet')));
}
