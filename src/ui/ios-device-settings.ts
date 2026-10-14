/** IOS router / switch → «Equipo»: name in the workspace and `hostname` of the running configuration. */
import { el } from './dom.ts';
import { field, input, button, message, table } from './forms.ts';
import type { IosDevice } from '../ios/device.ts';
import type { Placed } from '../net/topology.ts';
import { applyConfig } from '../ios/session.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

const MAX_LABEL = 40;
/** Same rule as the CLI `hostname`: a leading letter, one word, at most 63 characters. */
const IOS_HOSTNAME = /^[A-Za-z]\S{0,62}$/;

interface IosIfaceRow {
  readonly name: string;
  readonly address: string;
  readonly state: string;
}

function ifaceRows(d: IosDevice): IosIfaceRow[] {
  return [...d.ifaces.values()].map((c) => ({
    name: c.name,
    address: c.address ? `${formatIp(c.address.ip)} ${formatMask(c.address.prefix)}` : '—',
    state: c.shutdown ? t('iosdev.down') : t('iosdev.up'),
  }));
}

export interface IosDevicePanel {
  readonly root: HTMLElement;
  /** Draws the panel again (the CLI may have changed the hostname or the interfaces). */
  refresh(): void;
}

export function iosDeviceSettings(placed: Placed, d: IosDevice, app: { afterCommand(): void; retitle(title: string): void }): IosDevicePanel {
  const msg = message();
  const root = el('div', { class: 'pane' });
  const refresh = (): void => {
    // The CLI may have renamed the device since the last visit.
    app.retitle(`${placed.label} · ${d.hostname}`);
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL) });
    const hostname = input({ value: d.hostname, maxlength: '63' });
    const save = (): void => {
      const name = hostname.value.trim();
      const shown = label.value.trim();
      // Only a changed hostname is checked: one set from the CLI or a saved file is kept as it is.
      if (name !== d.hostname && !IOS_HOSTNAME.test(name)) return msg.error(t('iosdev.badHostname'));
      if (!shown) return msg.error(t('host.labelEmpty'));
      const errors = name !== d.hostname ? applyConfig(d, [`hostname ${name}`]) : [];
      if (errors.length) return msg.error(errors.join(' '));
      placed.label = shown.slice(0, MAX_LABEL);
      app.afterCommand();
      refresh();
      msg.ok(t('host.saved', { name: d.hostname }));
    };
    root.replaceChildren(
      el('h3', {}, t('host.nameTitle')),
      el('div', { class: 'grid2' },
        field(t('host.label'), label, t('host.labelHint')),
        field(t('host.hostname'), hostname, t('iosdev.hostnameHint'))),
      el('div', { class: 'actions' }, button(t('host.save'), save)),
      msg.el,
      el('h3', {}, t('iosdev.ifaces')),
      table<IosIfaceRow>(ifaceRows(d), [
        { label: t('iosdev.iface'), value: (r) => r.name, mono: true },
        { label: t('iosdev.address'), value: (r) => r.address, mono: true },
        { label: t('iosdev.state'), value: (r) => r.state },
      ], { empty: '—' }),
      el('h3', {}, t('host.equivalents')),
      el('ul', { class: 'muted' }, el('li', {}, t('iosdev.eq')), el('li', {}, t('iosdev.eqIfaces'))),
    );
  };
  refresh();
  return { root, refresh: () => { msg.clear(); refresh(); } };
}
