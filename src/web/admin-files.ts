/** Estado → Ficheros of the management GUI: the configuration files of a service as they are now (read-only). */
import { t, tDynamic } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child } from './html.ts';
import { cards, section } from './admin-layout.ts';
import { hostFs } from '../devices/host-fs.ts';
import { configFiles, configSources } from '../services/config-files.ts';

export function filesPage(server: Server, base: string, q: ReadonlyMap<string, string>): Child {
  const sources = configSources(server);
  const current = sources.find((s) => s.id === q.get('svc')) ?? sources[0];
  if (!current) return null;
  const tabs = sources.map((s) => h('li', { class: s.id === current.id ? 'web-adm-on' : undefined },
    h('a', { href: `${base}/?page=files&svc=${s.id}` }, tDynamic(s.label))));
  const fs = hostFs(server);
  const files = fs ? configFiles(fs, current.id) : [];
  return [
    h('ul', { class: 'web-adm-tabs' }, tabs),
    cards(section(tDynamic(current.label), t('files.hint'),
      files.length ? files.map((f) => [h('h3', { class: 'web-adm-mono' }, f.path), h('pre', { class: 'web-adm-log' }, f.content)]) : t('files.none'))),
  ];
}
