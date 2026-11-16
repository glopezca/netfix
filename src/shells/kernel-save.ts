/**
 * What the GUI and the web admin save: a kernel parameter applied and written in /etc/sysctl.conf, so the file shows
 * what the lab boots with (sysctl -w and /proc stay runtime-only, as on Ubuntu).
 */
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';
import { hostSystem } from './host-system.ts';
import { NETFIX_SYSCTL, SYSCTL_CONF } from './kernel-files.ts';
import { parseSysctlConf } from '../net/sysctl.ts';

const readText = (fs: Vfs, path: string): string | null => (fs.tryLookup(path)?.kind === 'file' ? fs.readFile(path) : null);

/** `key = value` in place of `line` (also a commented `#key=…`, which is uncommented), keeping its spacing. */
const withValue = (line: string, value: string): string => line.replace(/^\s*[#;]\s*/, '').replace(/(=\s*).*$/, (_, eq: string) => `${eq}${value}`);

/** sysctl.conf with the key's line set: the active one, else the commented stock one, else a new line at the end. */
function confWith(text: string, key: string, value: string): string {
  const lines = text.split('\n');
  const isKey = (l: string): boolean => parseSysctlConf(l).some((e) => e.key === key);
  const commented = (l: string): boolean => /^\s*[#;]/.test(l) && isKey(l.replace(/^\s*[#;]\s*/, ''));
  const active = lines.findIndex(isKey);
  const at = active >= 0 ? active : lines.findIndex(commented);
  // Later active lines would win on `sysctl -p`: they go, so the file says one thing.
  const out = lines.flatMap((l, i) => (i === at ? [withValue(l, value)] : isKey(l) ? [] : [l]));
  if (at < 0) out.splice(out.at(-1) === '' ? out.length - 1 : out.length, 0, `${key} = ${value}`);
  return `${out.join('\n').replace(/\n*$/, '')}\n`;
}

/** Labs saved before 0.52 kept GUI values in 99-netfix.conf: the key leaves it, and the file goes when nothing is left. */
function dropLegacy(fs: Vfs, key: string): void {
  const old = readText(fs, NETFIX_SYSCTL);
  if (old === null || !parseSysctlConf(old).some((e) => e.key === key)) return;
  const kept = old.split('\n').filter((l) => !parseSysctlConf(l).some((e) => e.key === key)).join('\n');
  if (parseSysctlConf(kept).length === 0) fs.remove(NETFIX_SYSCTL);
  else fs.writeFile(NETFIX_SYSCTL, kept, undefined, false, 0o644);
}

/** Applies `key = value` and records it in /etc/sysctl.conf. Returns an error (sysctl's words) or null. */
export function saveSysctl(host: Host, key: string, value: string): string | null {
  const r = host.kernel.sysctl.set(key, value);
  if (r === 'unknown') return `sysctl: cannot stat /proc/sys/${key.replace(/\./g, '/')}: No such file or directory`;
  if (r === 'invalid') return `sysctl: setting key "${key}": Invalid argument`;
  const fs = hostSystem(host).fs;
  fs.writeFile(SYSCTL_CONF, confWith(readText(fs, SYSCTL_CONF) ?? '', key, value), undefined, false, 0o644);
  dropLegacy(fs, key);
  return null;
}
