/** The Servicios list of a device with both systems: its panels under a GNU/Linux heading and a Windows one. */
import { subnav } from './forms.ts';
import type { SubnavItem } from './forms.ts';
import { panelGroups } from '../net/pkg-units.ts';
import type { AppsDevice } from '../net/device-apps.ts';

const SYSTEM_NAME = { linux: 'GNU/Linux', windows: 'Windows' } as const;

export function systemSubnav(d: AppsDevice, items: readonly SubnavItem[]): HTMLElement {
  const groups = panelGroups(d, items.map((i) => i.id));
  if (!groups) return subnav(items);
  return subnav(groups.flatMap(([os, ids]) => items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i, group: SYSTEM_NAME[os] }))));
}
