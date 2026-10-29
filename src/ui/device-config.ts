/**
 * The Configuración tab of a PC, Server or Linux router: which applications, service panels and terminals the device
 * shows, among what its lab allows. A change reopens the window with the new tabs.
 */
import { el } from './dom.ts';
import { t, tDynamic } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { APPS_BY_KIND, PC_APPS, deviceApps, labAllows, labViewOf, setDeviceApps } from '../net/device-apps.ts';
import type { FeatureId } from '../net/lab-features.ts';
import type { Host } from '../devices/host.ts';

const TERMINALS: readonly FeatureId[] = ['linux', 'windows'];

/** The PC applications and terminals are named as their tabs; the service panels as in Laboratorio actual. */
const TAB_NAMES: Readonly<Partial<Record<FeatureId, MessageKey>>> = {
  ip: 'win.ip', browser: 'win.browser', mail: 'win.mail', ssh: 'ssh.tab', sftp: 'sftp.tab', linux: 'win.linuxTerm', windows: 'win.cmd',
};

function appName(h: Host, id: FeatureId): string {
  const tab = TAB_NAMES[id];
  return tab && (h.kind === 'pc' || TERMINALS.includes(id) || id === 'ip') ? t(tab) : tDynamic(`set.feat.${id}`);
}

function group(title: string, boxes: readonly HTMLElement[]): HTMLElement[] {
  return boxes.length ? [el('fieldset', { class: 'set-group dev-group' }, el('legend', {}, title), ...boxes)] : [];
}

export function deviceConfig(h: Host, reopen: () => void): HTMLElement {
  const allowed = APPS_BY_KIND[h.kind].filter((id) => labAllows(labViewOf(h).features, h.kind, id));
  const box = (id: FeatureId): HTMLElement => {
    const input = el('input', { type: 'checkbox', name: `dev-${id}`, checked: deviceApps(h).includes(id) });
    input.addEventListener('change', () => {
      const rest = deviceApps(h).filter((x) => x !== id);
      setDeviceApps(h, input.checked ? [...rest, id] : rest);
      reopen();
    });
    return el('label', { class: 'set-choice' }, input, appName(h, id));
  };
  const apps = h.kind === 'pc' ? allowed.filter((id) => id === 'ip' || PC_APPS.includes(id)) : allowed.filter((id) => id === 'ip');
  const services = h.kind === 'pc' ? [] : allowed.filter((id) => id !== 'ip' && !TERMINALS.includes(id));
  return el('section', { class: 'dev-config', 'aria-label': t('dev.tab') },
    el('p', { class: 'muted' }, t('dev.intro')),
    ...group(t('dev.apps'), apps.map(box)),
    ...group(t('dev.services'), services.map(box)),
    ...group(t('dev.terminals'), allowed.filter((id) => TERMINALS.includes(id)).map(box)));
}
