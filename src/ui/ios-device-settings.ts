/** IOS router / switch → «Equipo»: name in the workspace and `hostname` of the running configuration. */
import { el, replaceKeepingFocus } from './dom.ts';
import { field, input, message, onCommit } from './forms.ts';
import type { IosDevice } from '../ios/device.ts';
import type { Placed } from '../net/topology.ts';
import { applyConfig } from '../ios/session.ts';
import { t } from '../i18n/t.ts';

const MAX_LABEL = 40;
/** Same rule as the CLI `hostname`: a leading letter, one word, at most 63 characters. */
const IOS_HOSTNAME = /^[A-Za-z]\S{0,62}$/;

export interface IosDevicePanel {
  readonly root: HTMLElement;
  /** Draws the panel again (the CLI may have changed the hostname). */
  refresh(): void;
}

export function iosDeviceSettings(placed: Placed, d: IosDevice, app: { afterCommand(): void; retitle(title: string): void }): IosDevicePanel {
  const msg = message();
  const root = el('div', { class: 'pane' });
  const refresh = (): void => {
    // The CLI may have renamed the device since the last visit.
    app.retitle(`${placed.label} · ${d.hostname}`);
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), name: 'label' });
    const hostname = input({ value: d.hostname, maxlength: '63', name: 'hostname' });
    // Each field applies on its own when it changes (Enter or leaving it), as `hostname` does in the CLI.
    onCommit(label, () => {
      const shown = label.value.trim().slice(0, MAX_LABEL);
      if (!shown) { label.value = placed.label; return msg.error(t('host.labelEmpty')); }
      if (shown === placed.label) return;
      placed.label = shown;
      app.afterCommand();
      refresh();
      msg.ok(t('iosdev.labelSaved'));
    });
    onCommit(hostname, () => {
      const name = hostname.value.trim();
      if (name === d.hostname) return;
      if (!IOS_HOSTNAME.test(name)) { hostname.value = d.hostname; return msg.error(t('iosdev.badHostname')); }
      const errors = applyConfig(d, [`hostname ${name}`]);
      if (errors.length) return msg.error(errors.join(' '));
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
