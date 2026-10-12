/** Every builtin of bash 5.3 available in netsim. */
import type { CommandFn } from '../types.ts';
import { CORE } from './core.ts';
import { VARS } from './vars.ts';
import { DIRS } from './dirs.ts';
import { READ } from './read.ts';
import { TEST } from './test.ts';
import { INFO } from './info.ts';
import { HIST } from './hist.ts';
import { JOBS } from './jobs.ts';

export const BUILTINS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([...CORE, ...VARS, ...DIRS, ...READ, ...TEST, ...INFO, ...HIST, ...JOBS]);
