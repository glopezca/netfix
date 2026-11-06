/**
 * Whether a device's Configuración tab offers a service box: always when the service is installed (so it can be
 * removed) or has no package of its own (files); otherwise only while the lab keeps one of its packages in the archive,
 * since ticking the box is installing that package.
 */
import type { AppsDevice } from '../net/device-apps.ts';
import { APPS_BY_KIND, deviceApps, sambaAllowed, setDeviceApps } from '../net/device-apps.ts';
import { installedPackage } from './apt-state.ts';
import { setAptInstalled } from './apt-install.ts';
import type { FeatureId } from '../net/lab-features.ts';
import { SERVICE_PACKAGES, TOOL_PACKAGES, labHasPackage } from '../net/lab-packages.ts';
import { PKG_UNITS, linuxSide, sambaOffered } from '../net/pkg-units.ts';
import { runsServices } from '../devices/kinds.ts';
import type { Host } from '../devices/host.ts';
import { findPackage } from './apt-catalog.ts';

/** The catalogue packages of a service box (the mail box has three: postfix, dovecot-imapd, dovecot-pop3d). */
export function servicePackages(id: FeatureId): string[] {
  return SERVICE_PACKAGES.filter((name) => findPackage(name)?.feature === id);
}

export function serviceOffered(d: AppsDevice, id: FeatureId): boolean {
  // Without a GNU/Linux terminal there is no apt: the box is the only way, as before.
  if (!linuxSide(d) || deviceApps(d).includes(id)) return true;
  const pkgs = servicePackages(id);
  return pkgs.length === 0 || pkgs.some((name) => labHasPackage(d, name));
}

/**
 * A service box ticked or unticked: on a GNU/Linux device it is apt install / apt remove of its packages (so the
 * package boxes, Servicios, the web GUI and apt agree); a box without packages, or a device without apt, only shows
 * or hides the panel.
 */
export function setServiceBox(h: Host, id: FeatureId, on: boolean): void {
  // Only a Server's or router's service boxes (a PC's SSH box is its client, not openssh-server).
  const pkgs = linuxSide(h) && runsServices(h.kind) ? servicePackages(id) : [];
  if (pkgs.length) for (const name of pkgs) setAptInstalled(h, name, on);
  if (deviceApps(h).includes(id) === on) return;
  const rest = deviceApps(h).filter((x) => x !== id);
  setDeviceApps(h, on ? [...rest, id] : rest);
}

/** A service package that does something on this device: a panel of it, or units it runs (nftables and samba on a PC). */
function effective(h: Host, name: string): boolean {
  if (name === 'samba') return sambaOffered(h);
  const feature = findPackage(name)?.feature;
  if (feature !== undefined && runsServices(h.kind) && APPS_BY_KIND[h.kind].includes(feature)) return true;
  return PKG_UNITS.some((u) => u.pkg === name && !(u.pcOnly && runsServices(h.kind)));
}

/** One catalogue package as the device's Configuración tab and its web GUI list it. */
export interface ListedPackage {
  readonly name: string;
  readonly installed: boolean;
  readonly service: boolean;
}

/** The device's catalogue that its lab keeps, or that it has installed (so it can be removed), with apt's state. */
export function listedPackages(h: Host): ListedPackage[] {
  const installed = (name: string): boolean => { const p = findPackage(name); return p !== undefined && installedPackage(h, p); };
  return devicePackages(h)
    .filter((name) => installed(name) || (labHasPackage(h, name) && (name !== 'samba' || sambaAllowed(h))))
    .map((name) => ({ name, installed: installed(name), service: (SERVICE_PACKAGES as readonly string[]).includes(name) }));
}

/** The catalogue of the device's Configuración tab (a GNU/Linux terminal only): its service packages, then the tools. */
export function devicePackages(h: Host): string[] {
  if (!linuxSide(h)) return [];
  return [...SERVICE_PACKAGES.filter((name) => effective(h, name)), ...TOOL_PACKAGES];
}
