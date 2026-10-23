/**
 * PC / Server / Linux router → «Equipo»: the device name, applied as soon as it changes. The host name is derived from
 * it (lowercase, no accents, hyphens) and shown read-only: nothing else can change it (net/device-names.ts).
 */
import { el } from './dom.ts';
import { field, input, message, onCommit } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { Host } from '../devices/host.ts';
import type { Placed } from '../net/topology.ts';
import { renameDevice } from '../net/device-names.ts';
import { t } from '../i18n/t.ts';

const MAX_LABEL = 40;

export function hostSettings(placed: Placed, h: Host, app: AfterChange & { retitle?: (title: string) => void }): LivePanel {
  // Outside the redraw: an action that changes the device redraws the panel before reporting.
  const msg = message();
  return liveHostPanel(h, (refresh) => {
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), name: 'label' });
    const hostname = input({ value: h.name, readonly: '', class: 'mono', name: 'hostname', tabindex: '-1' });
    const pretty = input({ value: h.prettyName ?? '', placeholder: t('host.prettyPlaceholder'), name: 'pretty' });
    onCommit(label, () => {
      const shown = label.value.trim().slice(0, MAX_LABEL);
      if (!shown) { label.value = placed.label; return msg.error(t('host.labelEmpty')); }
      if (shown === placed.label) return;
      renameDevice(placed, shown);
      const name = h.name;
      app.retitle?.(shown);
      app.afterCommand();
      refresh();
      msg.ok(t('host.saved', { name }));
    });
    onCommit(pretty, () => {
      h.setPrettyName(pretty.value.trim() || undefined);
      app.afterCommand();
      refresh();
    });
    const now = t('host.now', { static: h.name }) + (h.transientName ? t('host.nowTransient', { name: h.transientName }) : '') + (h.prettyName ? t('host.nowPretty', { name: h.prettyName }) : '') + '.';
    return [
      el('h3', {}, t('host.nameTitle')),
      el('div', { class: 'grid2' },
        field(t('host.label'), label, t('host.labelHint')),
        field(t('host.hostname'), hostname, t('host.hostnameHint'))),
      field(t('host.pretty'), pretty, t('host.prettyHint')),
      msg.el,
      el('p', { class: 'muted live-note' }, t('host.live')),
      el('h3', {}, t('host.equivalents')),
      el('ul', { class: 'muted' }, el('li', {}, t('host.eqLinux')), el('li', {}, t('host.eqWindows')), el('li', { class: 'host-now' }, now)),
    ];
  });
}
