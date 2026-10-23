/** IOS router / switch → «Equipo»: name in the workspace and, derived from it, the `hostname` of the running configuration. */
import { el, replaceKeepingFocus } from './dom.ts';
import { field, input, message, onCommit } from './forms.ts';
import type { IosDevice } from '../ios/device.ts';
import type { Placed } from '../net/topology.ts';
import { renameDevice } from '../net/device-names.ts';
import { t } from '../i18n/t.ts';

const MAX_LABEL = 40;

export interface IosDevicePanel {
  readonly root: HTMLElement;
  /** Draws the panel again. */
  refresh(): void;
}

export function iosDeviceSettings(placed: Placed, d: IosDevice, app: { afterCommand(): void; retitle(title: string): void }): IosDevicePanel {
  const msg = message();
  const root = el('div', { class: 'pane' });
  const refresh = (): void => {
    app.retitle(`${placed.label} · ${d.hostname}`);
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), name: 'label' });
    // As on the Linux devices, the hostname is derived from the name: shown, never edited.
    const hostname = input({ value: d.hostname, readonly: '', class: 'mono', name: 'hostname', tabindex: '-1' });
    onCommit(label, () => {
      const shown = label.value.trim().slice(0, MAX_LABEL);
      if (!shown) { label.value = placed.label; return msg.error(t('host.labelEmpty')); }
      if (shown === placed.label) return;
      renameDevice(placed, shown);
      app.afterCommand();
      refresh();
      msg.ok(t('host.saved', { name: d.hostname }));
    });
    replaceKeepingFocus(root, [
      el('h3', {}, t('host.nameTitle')),
      el('div', { class: 'grid2' },
        field(t('host.label'), label, t('iosdev.labelHint')),
        field(t('host.hostname'), hostname, t('iosdev.hostnameHint'))),
      msg.el,
      el('h3', {}, t('host.equivalents')),
      el('ul', { class: 'muted' }, el('li', {}, t('iosdev.eq')), el('li', {}, t('iosdev.eqIfaces'))),
    ]);
  };
  refresh();
  return { root, refresh: () => { msg.clear(); refresh(); } };
}
