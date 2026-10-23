/**
 * Servicios → Configuración: the configuration files of the chosen service as they are now on disk, like Registros
 * shows its journal, highlighted as vim shows them. Read-only: the files are edited in the panels or in the terminal.
 */
import { t, tDynamic } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, select, button } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import type { Server } from '../devices/server.ts';
import { hostFs } from '../devices/host-fs.ts';
import { configFiles, configSources } from '../services/config-files.ts';
import { filetypeOf, highlight } from '../editors/vim-syntax.ts';

/** The file with vim's highlight groups (textContent only: the content is never parsed as HTML). */
export function syntaxView(path: string, content: string): HTMLElement {
  const ft = filetypeOf(path);
  const pre = el('pre', { class: 'log-view syn-view', 'data-filetype': ft });
  highlight(content, ft).forEach((line, i) => {
    if (i) pre.append('\n');
    for (const s of line) pre.append(s.group ? el('span', { class: `syn-${s.group.toLowerCase()}` }, s.text) : s.text);
  });
  return pre;
}

export function filesPanel(server: Server, first = 'ssh'): HTMLElement {
  const sources = configSources(server);
  let selected = sources.some((s) => s.id === first) ? first : sources[0]?.id ?? 'ssh';
  return livePanel((refresh) => {
    const pick = select(sources.map((s) => [s.id, tDynamic(s.label)] as const), selected);
    pick.addEventListener('change', () => { selected = pick.value; refresh(); });
    const fs = hostFs(server);
    const files = fs ? configFiles(fs, selected) : [];
    return [
      el('div', { class: 'inline-form' }, field(t('srv.service'), pick), button(t('srv.refresh'), () => { refresh(); })),
      el('p', { class: 'muted' }, t('files.hint')),
      ...(files.length ? files.map((f) => el('section', { class: 'conf-file' },
        el('h4', { class: 'mono' }, f.path), syntaxView(f.path, f.content))) : [el('p', { class: 'muted' }, t('files.none'))]),
    ];
  });
}
