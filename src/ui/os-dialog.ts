/**
 * The question when a PC is placed: Linux, Windows or both. Windows is focused, and Esc or a click outside keeps it
 * (the default system). Servers do not ask: they run GNU/Linux until changed.
 */
import { el } from './dom.ts';
import { button } from './forms.ts';
import { t } from '../i18n/t.ts';
import { choosePcSystem, freshApps, setDeviceApps } from '../net/device-apps.ts';
import type { PcSystem } from '../net/device-apps.ts';
import type { Placed } from '../net/topology.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';

export function askPcSystem(name: string): Promise<PcSystem> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'os-dialog', 'aria-labelledby': 'os-title', 'aria-describedby': 'os-body' });
    const close = (answer: PcSystem): void => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const choice = (s: PcSystem): HTMLButtonElement => button(t(`os.${s}`), () => close(s), s === 'windows' ? 'btn btn-primary' : 'btn');
    const windows = choice('windows');
    dialog.append(
      el('h2', { id: 'os-title', class: 'confirm-title' }, t('os.title', { name })),
      el('p', { id: 'os-body', class: 'confirm-body' }, t('os.body')),
      el('div', { class: 'confirm-actions' }, choice('linux'), windows, choice('both')),
    );
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close('windows'); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close('windows'); });
    document.body.appendChild(dialog);
    dialog.showModal();
    windows.focus();
  });
}

/**
 * After a device is placed: a PC asks for its system; a Server or Linux router starts with no service running (its
 * boxes are off until ticked or installed with apt, and Apache is not there yet). Either way it is unsaved work.
 */
export function afterPlaced(placed: Placed, changed: () => void): void {
  const pc = placed.device;
  if (pc instanceof Server) {
    pc.setServices({ ...pc.services, http: { ...pc.services.http, enabled: false } });
    setDeviceApps(pc, freshApps(pc));
  }
  changed();
  if (pc instanceof Pc) void askPcSystem(placed.label).then((s) => { choosePcSystem(pc, s); changed(); });
}
