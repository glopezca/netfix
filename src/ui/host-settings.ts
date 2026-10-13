/** PC / Server → «Equipo»: name shown in the workspace and the host name of the system (follows the terminal). */
import { el } from './dom.ts';
import { field, input, button, message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { Host } from '../devices/host.ts';
import { validHostname } from '../devices/host.ts';
import type { Placed } from '../net/topology.ts';
import { t } from '../i18n/t.ts';

const MAX_LABEL = 40;

export function hostSettings(placed: Placed, h: Host, app: AfterChange & { retitle?: (title: string) => void }): LivePanel {
  return liveHostPanel(h, (refresh) => {
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), 'aria-describedby': 'label-hint' });
    const hostname = input({ value: h.name, maxlength: '253' });
    const pretty = input({ value: h.prettyName ?? '', placeholder: t('host.prettyPlaceholder') });
    const msg = message();
    const save = (): void => {
      const name = hostname.value.trim();
      const err = validHostname(name);
      if (err) return msg.error(err);
      const shown = label.value.trim();
      if (!shown) return msg.error(t('host.labelEmpty'));
      placed.label = shown.slice(0, MAX_LABEL);
      h.setPrettyName(pretty.value.trim() || undefined);
      h.setHostname(name);
      app.retitle?.(placed.label);
      app.afterCommand();
      refresh();
      msg.ok(t('host.saved', { name }));
    };
    const same = button(t('host.useLabel'), () => { hostname.value = label.value.trim().replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(); });
    const now = t('host.now', { static: h.name }) + (h.transientName ? t('host.nowTransient', { name: h.transientName }) : '') + (h.prettyName ? t('host.nowPretty', { name: h.prettyName }) : '') + '.';
    return [
      el('h3', {}, t('host.nameTitle')),
      el('div', { class: 'grid2' },
        field(t('host.label'), label, t('host.labelHint')),
        field(t('host.hostname'), hostname, t('host.hostnameHint'))),
      field(t('host.pretty'), pretty, t('host.prettyHint')),
      el('div', { class: 'actions' }, button(t('host.save'), save), same),
      msg.el,
      el('p', { class: 'muted live-note' }, t('host.live')),
      el('h3', {}, t('host.equivalents')),
      el('ul', { class: 'muted' }, el('li', {}, t('host.eqLinux')), el('li', {}, t('host.eqWindows')), el('li', { class: 'host-now' }, now)),
    ];
  });
}
