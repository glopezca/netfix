/**
 * Nube ISP → «Equipo», as on the other devices: the name in the workspace (applied as soon as it changes) and the host
 * name derived from it, read-only. The provider's name and public block stay in the ISP tab.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, message, onCommit } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import type { Placed } from '../net/topology.ts';
import type { Cloud } from '../devices/cloud.ts';
import { renameDevice } from '../net/device-names.ts';

const MAX_LABEL = 40;

export function cloudSettings(placed: Placed, cloud: Cloud, app: { afterCommand(): void; retitle(title: string): void }): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), name: 'label' });
    const hostname = input({ value: cloud.name, readonly: '', class: 'mono', name: 'hostname', tabindex: '-1' });
    onCommit(label, () => {
      const shown = label.value.trim().slice(0, MAX_LABEL);
      if (!shown) { label.value = placed.label; return msg.error(t('host.labelEmpty')); }
      if (shown === placed.label) return;
      renameDevice(placed, shown);
      app.retitle(shown);
      app.afterCommand();
      refresh();
      msg.ok(t('host.saved', { name: cloud.name }));
    });
    return [
      el('h3', {}, t('host.nameTitle')),
      el('div', { class: 'grid2' }, field(t('host.label'), label, t('cloud.labelHint')), field(t('host.hostname'), hostname, t('cloud.hostnameHint'))),
      msg.el,
    ];
  });
}
