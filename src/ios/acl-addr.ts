/** Address and wildcard of an ACL entry: "any" | "host A.B.C.D" | "A.B.C.D [wildcard]". */
import { parseIp } from '../core/ip.ts';

export const ANY_WILDCARD = 0xffffffff;

export function parseSource(words: readonly string[]): { ip: number; wildcard: number } | string {
  const [first, second] = words;
  if (first === 'any') return { ip: 0, wildcard: ANY_WILDCARD };
  if (first === 'host') {
    const ip = parseIp(second ?? '');
    return ip === null ? '% Invalid input detected.' : { ip, wildcard: 0 };
  }
  const ip = parseIp(first ?? '');
  const wildcard = second === undefined ? 0 : parseIp(second);
  if (ip === null || wildcard === null) return '% Invalid input detected.';
  return { ip: (ip & ~wildcard) >>> 0, wildcard };
}
