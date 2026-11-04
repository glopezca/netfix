/**
 * Servicios → Registros: the journal of the chosen unit (journalctl -u … -n 100), with its state in the list. A Server or
 * the Linux router lists its own units and the packages' (smbd, nmbd); a GNU/Linux PC, only what apt installed.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, select, button } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import { fillSyntax } from './syntax-view.ts';
import type { Host } from '../devices/host.ts';
import { createShell } from '../shells/factory.ts';
import { findPkgUnit, journalUnits, pkgUnitState } from '../net/pkg-units.ts';

export interface LogUnit {
  readonly name: string;
  readonly active: boolean;
}

/** The units apt's packages brought, with their state now. */
export function packageLogUnits(host: Host): LogUnit[] {
  return journalUnits(host).map((name) => {
    const u = findPkgUnit(host, name);
    return { name, active: u !== undefined && pkgUnitState(host, u).active };
  });
}

/** `units` is read on every redraw, so a package installed or a service stopped shows at once. */
export function logPanel(host: Host, units: () => readonly LogUnit[], hint: string): HTMLElement {
  let selected = units()[0]?.name ?? '';
  return livePanel((refresh) => {
    const list = units();
    if (!list.length) return [el('p', { class: 'muted' }, t('pcsvc.noUnits'))];
    if (!list.some((u) => u.name === selected)) selected = list[0]?.name ?? '';
    const unit = select(list.map((u) => [u.name, `${u.name} (${u.active ? t('srv.active') : t('srv.stopped')})`] as const), selected);
    const out = el('pre', { class: 'log-view' });
    const show = (): void => {
      selected = unit.value;
      fillSyntax(out, createShell(host, 'linux', 'root').run(`journalctl -u ${unit.value} -n 100`).join('\n'), 'messages');
    };
    unit.addEventListener('change', show);
    show();
    return [el('div', { class: 'inline-form' }, field(t('srv.service'), unit), button(t('srv.refresh'), () => { refresh(); })), out,
      el('p', { class: 'muted' }, hint)];
  });
}
