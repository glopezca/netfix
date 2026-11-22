/**
 * Midnight Commander's setup: what Options › Configuration, Layout, Panel options and Confirmation change, saved by
 * Options › Save setup in mc's own ini file (~/.config/mc/ini; on Windows %APPDATA%\Midnight Commander\ini) with mc's
 * section and key names, and read again when mc starts.
 */
import type { McFs } from './mc-fs.ts';
import { joinPath } from './mc-fs.ts';

export interface McSetup {
  useInternalEdit: boolean;
  autoSaveSetup: boolean;
  confirmDelete: boolean;
  confirmExit: boolean;
  horizontalSplit: boolean;
  menubarVisible: boolean;
  keybarVisible: boolean;
  commandPrompt: boolean;
  showDotFiles: boolean;
  mixAllFiles: boolean;
  markMovesDown: boolean;
  showMiniInfo: boolean;
}

export const DEFAULT_SETUP: Readonly<McSetup> = {
  useInternalEdit: true, autoSaveSetup: true, confirmDelete: true, confirmExit: true,
  horizontalSplit: false, menubarVisible: true, keybarVisible: true, commandPrompt: true,
  showDotFiles: true, mixAllFiles: false, markMovesDown: true, showMiniInfo: true,
};

/** Each setting: its ini section and key, as mc writes them. */
const KEYS: readonly [keyof McSetup, string, string][] = [
  ['useInternalEdit', 'Midnight-Commander', 'use_internal_edit'], ['autoSaveSetup', 'Midnight-Commander', 'auto_save_setup'],
  ['confirmDelete', 'Midnight-Commander', 'confirm_delete'], ['confirmExit', 'Midnight-Commander', 'confirm_exit'],
  ['horizontalSplit', 'Layout', 'horizontal_split'], ['menubarVisible', 'Layout', 'menubar_visible'],
  ['keybarVisible', 'Layout', 'keybar_visible'], ['commandPrompt', 'Layout', 'command_prompt'],
  ['showDotFiles', 'Panels', 'show_dot_files'], ['mixAllFiles', 'Panels', 'mix_all_files'],
  ['markMovesDown', 'Panels', 'mark_moves_down'], ['showMiniInfo', 'Panels', 'show_mini_info'],
];

/** The folder of the ini file under the home folder. */
export const iniDir = (fs: McFs): string => joinPath(fs.profile ?? fs.home, fs.windows ? 'AppData/Roaming/Midnight Commander' : '.config/mc');
export const iniPath = (fs: McFs): string => joinPath(iniDir(fs), 'ini');

/** The setup in the ini file, over the defaults (no file, or a key missing or not true/false: the default). */
export function loadSetup(fs: McFs): McSetup {
  // With the host's editor program (as $EDITOR), mc starts with Use internal edit off: F4 opens that editor.
  const setup: McSetup = { ...DEFAULT_SETUP, useInternalEdit: fs.edit === undefined };
  const text = fs.read(iniPath(fs));
  if (typeof text !== 'string') return setup;
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) { section = head[1] ?? ''; continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    const def = kv && KEYS.find(([, s, k]) => s === section && k === kv[1]?.trim());
    const value = kv?.[2]?.trim();
    if (def && (value === 'true' || value === 'false' || value === '1' || value === '0')) setup[def[0]] = value === 'true' || value === '1';
  }
  return setup;
}

export function setupText(setup: Readonly<McSetup>): string {
  const sections = [...new Set(KEYS.map(([, s]) => s))];
  return sections.map((s) => [`[${s}]`, ...KEYS.filter(([, sec]) => sec === s).map(([f, , k]) => `${k}=${String(setup[f])}`)].join('\n')).join('\n\n') + '\n';
}

/** Writes the ini file (making its folder); an error message or null. */
export function saveSetup(fs: McFs, setup: Readonly<McSetup>): string | null {
  return fs.mkdir(iniDir(fs)) ?? fs.write(iniPath(fs), setupText(setup));
}
