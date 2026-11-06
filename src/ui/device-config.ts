/**
 * The Configuración tab of a PC, Server or Linux router: which applications, service panels and terminals the device
 * shows, among what its lab allows, whether Samba is installed, and the catalogue of apt packages (service packages
 * and tools, lab-packages.ts).
 * A change redraws the window with the new tabs (device-windows.ts).
 */
import { el } from './dom.ts';
import { t, tDynamic } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { APPS_BY_KIND, PC_APPS, deviceApps, labAllows, labViewOf, sambaAllowed, setDeviceApps } from '../net/device-apps.ts';
import type { FeatureId } from '../net/lab-features.ts';
import type { Host } from '../devices/host.ts';
import { linuxSide, sambaOffered } from '../net/pkg-units.ts';
import { hasPackage } from '../net/host-packages.ts';
import { setSambaInstalled } from '../shells/samba-install.ts';
import { setAptInstalled } from '../shells/apt-install.ts';
import { SERVICE_PACKAGES, labHasPackage } from '../net/lab-packages.ts';
import { devicePackages, serviceOffered, setServiceBox } from '../shells/apt-offer.ts';
import { findPackage } from '../shells/apt-catalog.ts';
import { installedPackage } from '../shells/apt-state.ts';
import { setWinShareOn, winShareOffered, winShareOn } from '../net/win-shares.ts';

const TERMINALS: readonly FeatureId[] = ['linux', 'windows'];
const SERVICE_SET: ReadonlySet<string> = new Set(SERVICE_PACKAGES);

/** The PC applications and terminals are named as their tabs; the service panels as in Laboratorio actual. */
const TAB_NAMES: Readonly<Partial<Record<FeatureId, MessageKey>>> = {
  ip: 'win.ip', browser: 'win.browser', mail: 'win.mail', ssh: 'ssh.tab', sftp: 'sftp.tab', linux: 'win.linuxTerm', windows: 'win.cmd',
};

function appName(h: Host, id: FeatureId): string {
  const tab = TAB_NAMES[id];
  return tab && (h.kind === 'pc' || TERMINALS.includes(id) || id === 'ip') ? t(tab) : tDynamic(`set.feat.${id}`);
}

/** Samba (when the lab allows it and the device has a GNU/Linux terminal): installs or removes the package, as apt. */
function sambaBox(h: Host, changed: () => void): HTMLElement[] {
  if (!sambaOffered(h) || (!hasPackage(h, 'samba') && !labHasPackage(h, 'samba'))) return [];
  const input = el('input', { type: 'checkbox', name: 'dev-samba', checked: hasPackage(h, 'samba') });
  input.addEventListener('change', () => { setSambaInstalled(h, input.checked); changed(); });
  return [el('label', { class: 'set-choice' }, input, t('smb.tab'))];
}

/** File and printer sharing for Microsoft networks (a Windows device whose lab offers it): SMB/NetBIOS on or off. */
function winShareBox(h: Host, changed: () => void): HTMLElement[] {
  if (!winShareOffered(h)) return [];
  const input = el('input', { type: 'checkbox', name: 'dev-winshare', checked: winShareOn(h) });
  input.addEventListener('change', () => { setWinShareOn(h, input.checked); changed(); });
  return [el('label', { class: 'set-choice' }, input, t('dev.winshare'))];
}

/**
 * The catalogue packages of the device that its lab keeps, or that it has installed (so they can be removed): each box
 * is apt install / apt remove; a service package's box and its service box always agree (both read apt's state).
 */
function packageBoxes(h: Host, names: readonly string[], changed: () => void): HTMLElement[] {
  const installed = (name: string): boolean => { const p = findPackage(name); return p !== undefined && installedPackage(h, p); };
  return names.filter((name) => installed(name) || (labHasPackage(h, name) && (name !== 'samba' || sambaAllowed(h)))).map((name) => {
    const input = el('input', { type: 'checkbox', name: `dev-pkg-${name}`, checked: installed(name), 'data-pkg': name });
    input.addEventListener('change', () => { setAptInstalled(h, name, input.checked); changed(); });
    return el('label', { class: 'set-choice' }, input, el('code', {}, name));
  });
}

function group(title: string, boxes: readonly HTMLElement[]): HTMLElement[] {
  return boxes.length ? [el('fieldset', { class: 'set-group dev-group' }, el('legend', {}, title), ...boxes)] : [];
}

export function deviceConfig(h: Host, changed: () => void): HTMLElement {
  const allowed = APPS_BY_KIND[h.kind].filter((id) => labAllows(labViewOf(h).features, h.kind, id));
  const box = (id: FeatureId): HTMLElement => {
    const input = el('input', { type: 'checkbox', name: `dev-${id}`, checked: deviceApps(h).includes(id) });
    input.addEventListener('change', () => { setServiceBox(h, id, input.checked); changed(); });
    return el('label', { class: 'set-choice' }, input, appName(h, id));
  };
  const apps = h.kind === 'pc' ? allowed.filter((id) => id === 'ip' || PC_APPS.includes(id)) : allowed.filter((id) => id === 'ip');
  const services = h.kind === 'pc' ? [] : allowed.filter((id) => id !== 'ip' && !TERMINALS.includes(id) && serviceOffered(h, id));
  const packages = devicePackages(h);
  return el('section', { class: 'dev-config', 'aria-label': t('dev.tab') },
    el('p', { class: 'muted' }, t('dev.intro')),
    ...group(t('dev.apps'), apps.map(box)),
    ...group(t('dev.services'), [...services.map(box), ...sambaBox(h, changed), ...winShareBox(h, changed)]),
    ...group(t('dev.terminals'), allowed.filter((id) => TERMINALS.includes(id)).map(box)),
    ...group(t('dev.svcPackages'), packageBoxes(h, packages.filter((n) => SERVICE_SET.has(n)), changed)),
    ...group(t('dev.packages'), packageBoxes(h, packages.filter((n) => !SERVICE_SET.has(n)), changed)));
}
