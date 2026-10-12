/** awk values (numbers, strings and input strnums), conversions and control-flow signals. */
import { formatPrintf } from '../builtins/printf.ts';

/** A string that came from input: compared numerically when it looks like a number (POSIX "strnum"). */
export interface StrNum {
  readonly sn: string;
}

export type Val = number | string | StrNum;

export const NUMERIC = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

export class NextSig extends Error {}
export class ExitSig extends Error {
  readonly code: number;
  constructor(code: number) { super('exit'); this.code = code; }
}
export class BreakSig extends Error {}
export class ContinueSig extends Error {}
export class ReturnSig extends Error {
  readonly v: Val;
  constructor(v: Val) { super('return'); this.v = v; }
}

export function toNum(v: Val): number {
  if (typeof v === 'number') return v;
  const s = typeof v === 'string' ? v : v.sn;
  const m = /^\s*[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s);
  return m ? Number(m[0]) : 0;
}

export function numToStr(n: number, fmt: string): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  return formatPrintf(fmt, [String(n)], 0).passes.map((p) => p.text).join('');
}

export const isStrNum = (v: Val): v is StrNum => typeof v === 'object';

