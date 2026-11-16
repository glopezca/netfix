/**
 * BIND's address match lists (allow-recursion): the elements in order, the first that matches the client decides (a
 * `!` element refuses) and no match refuses. `localhost` is the server's own addresses and `localnets` the networks
 * of all its interfaces, both with 127.0.0.0/8, as named builds them from the interfaces it finds.
 */
import { formatIp, inSubnet, networkOf, parseIp } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

export type Aml = readonly string[];

/** BIND's default allow-recursion (also what Ubuntu's named.conf.options leaves implicit). */
export const DEFAULT_ALLOW_RECURSION: Aml = Object.freeze(['localnets', 'localhost']);
export const MAX_AML = 32;
const BUILTIN = ['any', 'none', 'localhost', 'localnets'];
const MAX_ACL_DEPTH = 8;
const MAX_ACL_VISITS = 1024;

export interface LocalAddress { readonly ip?: number; readonly prefix?: number }

/** a.b.c.d, a.b.c.d/n or BIND's short form (10/8, 192.168/16): [network, prefix], or null. */
function network(text: string): readonly [number, number] | null {
  const [addr = '', bits, extra] = text.split('/');
  const octets = addr.split('.');
  if (extra !== undefined || octets.length > 4 || (bits === undefined && octets.length !== 4)) return null;
  const ip = parseIp([...octets, '0', '0', '0'].slice(0, 4).join('.'));
  const prefix = bits === undefined ? 32 : /^\d{1,2}$/.test(bits) ? Number(bits) : NaN;
  return ip === null || !(prefix <= 32) ? null : [ip, prefix];
}

const isElement = (e: string): boolean => {
  const body = e.startsWith('!') ? e.slice(1) : e;
  return BUILTIN.includes(body) || network(body) !== null;
};

/** The elements of a list typed or read from a file (`;`, `,` or spaces between them), or a translated error. */
export function parseAml(text: string): Aml | { error: string } {
  const list = text.replace(/!\s+/g, '!').split(/[;,\s]+/).filter(Boolean)
    .map((e) => (BUILTIN.includes(e.replace(/^!/, '').toLowerCase()) ? e.toLowerCase() : e));
  if (list.length > MAX_AML) return { error: t('dns.err.amlMany', { max: MAX_AML }) };
  const bad = list.find((e) => !isElement(e));
  return bad === undefined ? list : { error: t('dns.err.aml', { value: bad }) };
}

/**
 * Replaces `acl` names defined in the same file by their elements; a name not defined matches nobody (`none`).
 * It stops past MAX_AML elements (parseAml then refuses the list), so nested acls cannot blow up a hand-made file.
 */
export function expandAcls(list: Aml, acls: ReadonlyMap<string, Aml>): string[] {
  const out: string[] = [];
  // Every element visited counts, acl names too: empty acls nested many times push nothing but would still take k^8 steps.
  let budget = MAX_ACL_VISITS;
  const walk = (items: Aml, negated: boolean, depth: number): void => {
    for (const e of items) {
      if (out.length > MAX_AML || --budget < 0) return;
      const neg = e.startsWith('!') !== negated;
      const name = (e.startsWith('!') ? e.slice(1) : e).toLowerCase();
      const body = BUILTIN.includes(name) || network(name) !== null ? undefined : acls.get(name);
      // shortcut: !acl negates each element, exact when the acl has no `!` of its own; nest lists if that is needed.
      if (body && depth < MAX_ACL_DEPTH) { walk(body, neg, depth + 1); continue; }
      const known = BUILTIN.includes(name) || network(name) !== null;
      out.push(known ? `${neg ? '!' : ''}${name}` : 'none'); // an undefined acl, or one nested too deep, matches nobody
    }
  };
  walk(list, false, 0);
  // Out of budget: one element too many, so parseAml refuses the list instead of using a part of it.
  return budget < 0 ? Array.from({ length: MAX_AML + 1 }, () => 'none') : out;
}

const isLoopback = (client: number): boolean => (client >>> 24) === 127;

function matches(element: string, client: number, local: readonly LocalAddress[]): boolean {
  if (element === 'any') return true;
  if (element === 'none') return false;
  if (element === 'localhost') return isLoopback(client) || local.some((l) => l.ip === client);
  if (element === 'localnets') {
    return isLoopback(client) || local.some((l) => l.ip !== undefined && l.prefix !== undefined && inSubnet(client, l.ip, l.prefix));
  }
  const net = network(element);
  return net !== null && inSubnet(client, net[0], net[1]);
}

/** Whether the list allows `client`, given the server's interface addresses. */
export function amlAllows(list: Aml, client: number, local: readonly LocalAddress[]): boolean {
  for (const e of list) {
    const negated = e.startsWith('!');
    if (matches(negated ? e.slice(1) : e, client, local)) return !negated;
  }
  return false;
}

/** What localnets is on this server: the networks of its interfaces and 127.0.0.0/8. */
export function localNetworks(local: readonly LocalAddress[]): string {
  const nets = local.flatMap((l) => (l.ip !== undefined && l.prefix !== undefined ? [`${formatIp(networkOf(l.ip, l.prefix))}/${l.prefix}`] : []));
  return [...new Set([...nets, '127.0.0.0/8'])].join(', ');
}

/** As named.conf writes it inside `{ … }` (without the last `;`). */
export const amlText = (list: Aml): string => list.join('; ');
