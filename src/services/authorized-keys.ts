/**
 * authorized_keys lines: `[options] keytype base64 [comment]` (sshd(8) AUTHORIZED_KEYS FILE FORMAT).
 * Options are tokenised with their quotes. from="…" is enforced; options that only restrict features
 * the simulator lacks (forwarding, pty, rc) are accepted; any option that would change what runs or who
 * may log in (command=, principals=, cert-authority…) makes the line unusable, as the key cannot be honoured.
 */
import { parsePublicLine, WIRE_NAME } from '../net/ssh-keys.ts';
import type { PublicKey } from '../net/ssh-keys.ts';
import { matchPattern } from '../bash/glob.ts';

const HARMLESS = new Set([
  'restrict', 'no-pty', 'pty', 'no-port-forwarding', 'port-forwarding', 'no-agent-forwarding', 'agent-forwarding',
  'no-x11-forwarding', 'x11-forwarding', 'no-user-rc', 'user-rc',
]);
const KEY_TYPES: ReadonlySet<string> = new Set(Object.values(WIRE_NAME));
const MAX_OPTIONS = 32;

export interface AuthorizedEntry {
  readonly key: PublicKey;
  /** Why the line cannot be used, when it has an unsupported or malformed option. */
  readonly error?: string;
  allowsFrom(ip: string): boolean;
}

/** Splits "opt1,opt2=\"a,b\"" at commas outside quotes; null when a quote is not closed. */
function splitOptions(text: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '\\' && quoted && text[i + 1] === '"') { cur += '"'; i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (quoted) return null;
  out.push(cur);
  return out;
}

/** Options and the rest of the line: the options field ends at the first space outside quotes. */
function cutOptions(line: string): { options: string; rest: string } {
  const first = line.split(/\s/, 1)[0] ?? '';
  if (KEY_TYPES.has(first)) return { options: '', rest: line };
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') quoted = !quoted;
    else if (!quoted && (c === ' ' || c === '\t')) return { options: line.slice(0, i), rest: line.slice(i + 1).trim() };
  }
  return { options: line, rest: '' };
}

/** from="pattern-list": a negated match denies, otherwise one positive match is needed. */
function fromMatcher(patterns: readonly string[]): (ip: string) => boolean {
  return (ip) => {
    if (patterns.some((p) => p.startsWith('!') && matchPattern(p.slice(1), ip))) return false;
    return patterns.some((p) => !p.startsWith('!') && matchPattern(p, ip));
  };
}

function readOptions(options: string): { from: string[]; error?: string } {
  if (!options) return { from: [] };
  const list = splitOptions(options);
  if (!list || list.length > MAX_OPTIONS) return { from: [], error: 'invalid quotes' };
  const from: string[] = [];
  for (const opt of list) {
    const eq = opt.indexOf('=');
    const name = (eq >= 0 ? opt.slice(0, eq) : opt).toLowerCase();
    if (name === 'from' && eq >= 0) from.push(...opt.slice(eq + 1).split(',').filter(Boolean));
    else if (!HARMLESS.has(name)) return { from, error: `${name} no está soportado en Netfix` };
  }
  return { from };
}

export function parseAuthorizedLine(raw: string): AuthorizedEntry | null {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;
  const { options, rest } = cutOptions(line);
  const key = parsePublicLine(rest);
  if (!key) return null;
  const opts = readOptions(options);
  const allowsFrom = opts.from.length ? fromMatcher(opts.from) : (): boolean => true;
  return opts.error ? { key, error: opts.error, allowsFrom } : { key, allowsFrom };
}
