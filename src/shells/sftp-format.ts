/** Output of OpenSSH's sftp/scp: `ls -l` lines, `ls` columns, the progress meter and error texts. */
import type { SftpEntry, SftpResult } from '../net/packets.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIX_MONTHS_MS = 182 * 86_400_000;
const TERM_WIDTH = 80;
const KIB = 1024;

function modeString(e: SftpEntry): string {
  const type = e.kind === 'dir' ? 'd' : e.kind === 'link' ? 'l' : '-';
  const bits = 'rwxrwxrwx'.split('').map((c, i) => ((e.mode >> (8 - i)) & 1 ? c : '-')).join('');
  return `${type}${bits}`;
}

function when(mtime: number, now: number): string {
  const d = new Date(mtime);
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())}`;
  return Math.abs(now - mtime) < SIX_MONTHS_MS ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : `${day}  ${d.getUTCFullYear()}`;
}

/** `-rw-r--r--    1 alice    alice          12 Oct 14 10:00 notes.txt` */
export function longLine(e: SftpEntry, now: number): string {
  return `${modeString(e)}    1 ${e.owner.padEnd(8)} ${e.group.padEnd(8)} ${String(e.size).padStart(8)} ${when(e.mtime, now)} ${e.name}`;
}

/** Names in columns, like sftp's `ls` without -l. */
export function columns(names: readonly string[]): string[] {
  if (!names.length) return [];
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const perRow = Math.max(1, Math.floor(TERM_WIDTH / width));
  const rows: string[] = [];
  for (let i = 0; i < names.length; i += perRow) rows.push(names.slice(i, i + perRow).map((n) => n.padEnd(width)).join('').trimEnd());
  return rows;
}

function amount(n: number): string {
  if (n < KIB) return String(n);
  return n < KIB * KIB ? `${(n / KIB).toFixed(1)}KB` : `${(n / KIB / KIB).toFixed(1)}MB`;
}

/** `notes.txt                       100%   12     0.0KB/s   00:00` */
export function progress(name: string, size: number): string {
  return `${name.padEnd(46)} 100% ${amount(size).padStart(5)} ${`${(size / KIB).toFixed(1)}KB/s`.padStart(9)}   00:00`;
}

/** OpenSSH's text for an SFTP status. */
export function statusText(r: SftpResult): string {
  if (r.status === 'no-such-file') return 'No such file or directory';
  if (r.status === 'permission-denied') return 'Permission denied';
  return r.message ?? 'Failure';
}
