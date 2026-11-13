/** What the GUI and the web admin save: kernel parameters in /etc/sysctl.d/99-netfix.conf (applied too). */
import type { Host } from '../devices/host.ts';
import { hostSystem } from './host-system.ts';
import { NETFIX_SYSCTL } from './kernel-files.ts';
import { parseSysctlConf } from '../net/sysctl.ts';
import { t } from '../i18n/t.ts';

const HEADER = '# Netfix: parámetros guardados desde la ventana del equipo o la gestión web.\n';

/** Applies `key = value` and records it in 99-netfix.conf (replacing an earlier value). Returns an error or null. */
export function saveSysctl(host: Host, key: string, value: string): string | null {
  const r = host.kernel.sysctl.set(key, value);
  if (r === 'unknown') return `sysctl: cannot stat /proc/sys/${key.replace(/\./g, '/')}: No such file or directory`;
  if (r === 'invalid') return `sysctl: setting key "${key}": Invalid argument`;
  if (r === 'denied') return `sysctl: permission denied on key "${key}" (${t('host.locked')})`;
  // kernel.hostname renamed the device, which is saved with the lab: nothing to record.
  if (key === 'kernel.hostname') return null;
  const fs = hostSystem(host).fs;
  const old = fs.tryLookup(NETFIX_SYSCTL)?.kind === 'file' ? fs.readFile(NETFIX_SYSCTL) : HEADER;
  const kept = old.split('\n').filter((l) => !parseSysctlConf(l).some((e) => e.key === key));
  const text = `${[...kept.filter((l, i) => l !== '' || i < kept.length - 1), `${key} = ${value}`].join('\n')}\n`;
  fs.writeFile(NETFIX_SYSCTL, text, undefined, false, 0o644);
  return null;
}
