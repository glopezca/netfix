/** Every external program (in /usr/bin) implemented by the bash core of Netfix. */
import type { CommandFn } from '../types.ts';
import { FILES } from './files.ts';
import { FILEINFO } from './fileinfo.ts';
import { TEXT } from './text.ts';
import { SYSINFO } from './sysinfo.ts';
import { TOOLS } from './tools.ts';
import { ls } from './ls.ts';
import { grep } from './grep.ts';
import { sed } from './sed.ts';
import { awk } from './awk.ts';
import { find } from './find.ts';
import { SHELLPROG } from './shellprog.ts';
import { EDITORS } from './editors.ts';
import { EXTRA } from './extra.ts';
import { HOSTNAME_TOOLS } from './hostnamectl.ts';
import { BAT_TOOLS } from './bat.ts';
import { MC_TOOLS } from './mc.ts';

export const COREUTILS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ...FILES, ...FILEINFO, ...TEXT, ...SYSINFO, ...TOOLS, ...SHELLPROG, ...EDITORS, ...EXTRA, ...HOSTNAME_TOOLS, ...BAT_TOOLS, ...MC_TOOLS,
  ['ls', ls], ['dir', ls], ['grep', grep], ['egrep', grep], ['fgrep', grep], ['sed', sed], ['awk', awk], ['mawk', awk], ['find', find],
]);
