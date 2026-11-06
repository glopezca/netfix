/**
 * What systemctl prints of a unit (systemd 257, Ubuntu): `status` (●, ○ or × and the Active line, with the failed
 * process after a start that failed) and the unit tables of `list-units` and `--failed`.
 */
import type { UnitStart } from '../services/units.ts';
import { plain } from './systemd-colors.ts';
import type { Paint } from './systemd-colors.ts';

/** What `systemctl status` shows of a unit, a Server's own or a package's. */
export interface UnitView {
  readonly linux: string;
  readonly description: string;
  readonly process: string;
  readonly pid: number;
  readonly path?: string;
  readonly oneshot: boolean;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly log: readonly string[];
  readonly start?: UnitStart;
  /** The failed start (since when and how the process exited). */
  readonly failed?: { readonly time: number; readonly status: string };
  readonly now: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The kernel keeps 15 characters of a process name (TASK_COMM_LEN): systemd-resolved is «systemd-resolve». */
const COMM_LEN = 15;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 2_629_800 * SEC;
const YEAR = 31_557_600 * SEC;

/** "Fri 2026-11-06 10:00:00 UTC" (systemd's format_timestamp, the simulation's clock being UTC). */
export function absoluteTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${DAYS[new Date(ms).getUTCDay()]} ${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

const per = (d: number, unit: number): number => Math.floor(d / unit);

/** systemd's format_timestamp_relative: "5s ago", "1min 30s ago", "11min ago", "2h 11min ago", "3 days ago"… */
export function relativeTime(from: number, now: number): string {
  const d = now - from;
  if (d <= 0) return 'now';
  if (d >= YEAR) return `${per(d, YEAR)} years ${per(d % YEAR, MONTH)} months ago`;
  if (d >= MONTH) return `${per(d, MONTH)} months ${per(d % MONTH, DAY)} days ago`;
  if (d >= WEEK) return `${per(d, WEEK)} weeks ${per(d % WEEK, DAY)} days ago`;
  if (d >= 2 * DAY) return `${per(d, DAY)} days ago`;
  if (d >= 25 * HOUR) return `1 day ${per(d - DAY, HOUR)}h ago`;
  if (d >= 6 * HOUR) return `${per(d, HOUR)}h ago`;
  if (d >= HOUR) return `${per(d, HOUR)}h ${per(d % HOUR, MIN)}min ago`;
  if (d >= 5 * MIN) return `${per(d, MIN)}min ago`;
  if (d >= MIN) return `${per(d, MIN)}min ${per(d % MIN, SEC)}s ago`;
  if (d >= SEC) return `${per(d, SEC)}s ago`;
  return `${d}ms ago`;
}

/**
 * The process that exited with an error; "Main PID" too when it was the main one (not a control process). systemd
 * paints the unclean exit of a Process line red, not the Main PID's.
 */
function failedLines(v: UnitView, f: { readonly time: number; readonly status: string }, p: Paint): string[] {
  const exited = `(code=exited, status=${f.status})`;
  const lines = [`     Active: ${p('failed', 'red')} (Result: exit-code) since ${absoluteTime(f.time)}; ${relativeTime(f.time, v.now)}`];
  if (v.start) lines.push(`    Process: ${v.start.pid ?? v.pid} ${v.start.exec} ${p(exited, 'red')}`);
  if (!v.start?.control) lines.push(`   Main PID: ${v.pid} ${exited}`);
  return lines;
}

function activeLines(v: UnitView, p: Paint): string[] {
  if (v.oneshot) return [`     Active: ${p('active (exited)', 'green')}`, `    Process: ${v.pid} ${v.start?.exec ?? `ExecStart=/usr/sbin/${v.process}`} (code=exited, status=0/SUCCESS)`, `   Main PID: ${v.pid} (code=exited, status=0/SUCCESS)`];
  return [`     Active: ${p('active (running)', 'green')}`, `   Main PID: ${v.pid} (${v.process.slice(0, COMM_LEN)})`, `     CGroup: /system.slice/${v.linux}.service`, `             └─${v.pid} ${v.path ?? `/usr/sbin/${v.process}`}`];
}

/** `systemctl status`; `p` paints as systemd does on a terminal (the log lines come already painted). */
export function status(v: UnitView, p: Paint = plain): string[] {
  const failed = v.active ? undefined : v.failed;
  const mark = v.active ? p('●', 'green') : failed ? p('×', 'red') : '○';
  const enabled = v.enabled ? p('enabled', 'green') : p('disabled', 'yellow');
  const lines = [
    `${mark} ${v.linux}.service - ${v.description}`,
    `     Loaded: loaded (/usr/lib/systemd/system/${v.linux}.service; ${enabled}; preset: ${p('enabled', 'green')})`,
    ...(v.active ? activeLines(v, p) : failed ? failedLines(v, failed, p) : ['     Active: inactive (dead)']),
  ];
  return v.log.length ? [...lines, '', ...v.log] : lines;
}

/** A row of `systemctl list-units`. */
export interface UnitRow {
  readonly name: string;
  readonly active: 'active' | 'inactive' | 'failed';
  readonly oneshot: boolean;
  readonly description: string;
}

const LEGEND = [
  'Legend: LOAD   → Reflects whether the unit definition was properly loaded.',
  '        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.',
  '        SUB    → The low-level unit activation state, values depend on unit type.',
];

/** The LOAD column keeps its colour; the other cells of a failed unit are red (systemd's on_active). */
const LOAD_COLUMN = 1;

/** `systemctl --failed` (list-units --state=failed): columns as wide as their widest cell, then the legend. */
export function failedTable(rows: readonly UnitRow[], p: Paint = plain): string[] {
  const cells = rows.map((r) => [`${r.name}.service`, 'loaded', 'failed', 'failed', r.description]);
  const head = ['UNIT', 'LOAD', 'ACTIVE', 'SUB', 'DESCRIPTION'];
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]?.length ?? 0)));
  const pad = (x: string, i: number, last: boolean): string => (last ? x : x.padEnd(widths[i] ?? 0));
  const header = p(`  ${head.map((x, i) => pad(x, i, i === head.length - 1)).join(' ')}`, 'underline');
  const row = (c: readonly string[]): string =>
    `${p('●', 'red')} ${c.map((x, i) => (i === LOAD_COLUMN ? pad(x, i, false) : p(pad(x, i, i === c.length - 1), 'red'))).join(' ')}`;
  const table = [header, ...cells.map(row)];
  return rows.length ? [...table, '', ...LEGEND, '', `${rows.length} loaded units listed.`] : [...table, '', '0 loaded units listed.'];
}
