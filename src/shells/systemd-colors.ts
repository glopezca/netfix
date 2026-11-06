/**
 * systemd's terminal colours (systemd 257: ansi-color.h, terminal-util.c, logs-show.c): whether systemctl and
 * journalctl use them, the escape sequences, and the colour of a journal line by its priority.
 */
import type { LogPriority } from '../devices/server.ts';

export type Color = 'red' | 'green' | 'yellow' | 'highlight' | 'underline';
/** Wraps text in a colour (or leaves it as it is when colours are off). */
export type Paint = (text: string, color: Color) => string;
export type ColorMode = 'off' | '16' | '256';

/** ANSI_HIGHLIGHT_RED, _GREEN, _YELLOW, ANSI_HIGHLIGHT and ANSI_UNDERLINE; ANSI_NORMAL ends each. */
const SGR_16: Readonly<Record<Color, string>> = {
  red: '\x1b[0;1;31m', green: '\x1b[0;1;32m', yellow: '\x1b[0;1;33m', highlight: '\x1b[0;1;39m', underline: '\x1b[0;4m',
};
/** With 256 colours or more, systemd's yellow is xterm's khaki3 (185). */
const SGR_256: Readonly<Record<Color, string>> = { ...SGR_16, yellow: '\x1b[0;1;38;5;185m' };
const NORMAL = '\x1b[0m';

export const plain: Paint = (text) => text;

export function painter(mode: ColorMode): Paint {
  if (mode === 'off') return plain;
  const codes = mode === '16' ? SGR_16 : SGR_256;
  return (text, color) => `${codes[color]}${text}${NORMAL}`;
}

const TRUE = new Set(['1', 'yes', 'y', 'true', 't', 'on']);
const FALSE = new Set(['0', 'no', 'n', 'false', 'f', 'off']);

/** SYSTEMD_COLORS: a boolean or 16, 256, 24bit; undefined when missing or not understood. */
function fromEnv(value: string | undefined): ColorMode | undefined {
  if (value === undefined) return undefined;
  const v = value.toLowerCase();
  if (FALSE.has(v)) return 'off';
  if (v === '16') return '16';
  if (TRUE.has(v) || v === '256' || v === '24bit') return '256';
  return undefined;
}

/**
 * get_color_mode(): SYSTEMD_COLORS decides first (even through a pipe); then NO_COLOR and TERM=dumb turn colours
 * off; otherwise they are on when stdout and stderr are the terminal.
 */
export function colorMode(env: (name: string) => string | undefined, onTty: boolean): ColorMode {
  const forced = fromEnv(env('SYSTEMD_COLORS'));
  if (forced !== undefined) return forced;
  if (env('NO_COLOR') !== undefined || env('TERM') === 'dumb' || !onTty) return 'off';
  return '256';
}

const BY_PRIORITY: Readonly<Record<LogPriority, Color>> = { err: 'red', warning: 'yellow', notice: 'highlight' };

/** A journal message in its priority's colour (err red, warning yellow, notice bold; info as it is). */
export function paintMessage(p: Paint, message: string, priority: LogPriority | undefined): string {
  return priority ? p(message, BY_PRIORITY[priority]) : message;
}
