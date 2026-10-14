/** Rule bodies: `ip saddr 10.0.0.0/24 tcp dport { 22, 80 } ct state new counter log prefix "x " accept`. */
import type { Field, Match, Rule, Value, Verdict } from './model.ts';
import { NFT_LIMITS } from './model.ts';
import type { Token } from './lexer.ts';
import { parseIp } from '../../core/ip.ts';

export class Cursor {
  private i = 0;
  readonly tokens: readonly Token[];
  /** Variables from `define NAME = value`. */
  readonly vars: Map<string, Token[]>;

  constructor(tokens: readonly Token[], vars = new Map<string, Token[]>()) {
    this.tokens = tokens;
    this.vars = vars;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  next(): Token | undefined {
    return this.tokens[this.i++];
  }

  /** True (and consumes) when the next token is `text`. */
  eat(text: string): boolean {
    if (this.peek()?.text !== text || this.peek()?.kind === 'string') return false;
    this.i++;
    return true;
  }

  atEnd(): boolean {
    const t = this.peek();
    return !t || t.kind === 'newline' || (t.kind === 'punct' && (t.text === ';' || t.text === '}'));
  }

  get pos(): number {
    return this.i;
  }
}

export class NftSyntaxError extends Error {
  readonly token: Token | undefined;

  constructor(message: string, token: Token | undefined) {
    super(message);
    this.token = token;
  }
}

const unexpected = (t: Token | undefined): NftSyntaxError =>
  new NftSyntaxError(`Error: syntax error, unexpected ${t ? (t.kind === 'newline' ? 'newline' : t.kind === 'string' ? 'quoted string' : t.text) : 'end of file'}`, t);

export const SERVICES: Readonly<Record<string, number>> = {
  ftp: 21, ssh: 22, telnet: 23, smtp: 25, domain: 53, bootps: 67, bootpc: 68, http: 80, pop3: 110, ntp: 123, imap: 143,
  https: 443, submission: 587, imaps: 993, pop3s: 995, wireguard: 51820, isakmp: 500, 'ipsec-nat-t': 4500,
};
export const CT_STATES = ['new', 'established', 'related', 'invalid', 'untracked'] as const;
export const ICMP_TYPES = ['echo-reply', 'destination-unreachable', 'echo-request', 'time-exceeded'] as const;
const PROTOCOLS = ['tcp', 'udp', 'icmp', 'esp'];

type Kind = 'addr' | 'port' | 'proto' | 'state' | 'iface' | 'icmp';

const FIELD_KIND: Readonly<Record<Field, Kind>> = {
  'ip saddr': 'addr', 'ip daddr': 'addr', 'ip protocol': 'proto', 'meta l4proto': 'proto',
  'tcp dport': 'port', 'tcp sport': 'port', 'udp dport': 'port', 'udp sport': 'port', 'th dport': 'port', 'th sport': 'port',
  'ct state': 'state', iif: 'iface', oif: 'iface', iifname: 'iface', oifname: 'iface', 'icmp type': 'icmp',
};

function scalar(kind: Kind, t: Token): Value {
  const w = t.text;
  if (kind === 'iface') return { kind: 'word', w };
  if (t.kind === 'string') throw unexpected(t);
  if (kind === 'addr') {
    const [ip, prefix] = w.split('/');
    const addr = parseIp(ip ?? '');
    const p = prefix === undefined ? 32 : Number(prefix);
    if (addr === null || !Number.isInteger(p) || p < 0 || p > 32) throw new NftSyntaxError(`Error: Could not resolve hostname: Name or service not known`, t);
    return { kind: 'addr', ip: addr, prefix: p };
  }
  if (kind === 'port') {
    const range = /^(\w+)-(\w+)$/.exec(w);
    const port = (s: string): number => (/^\d+$/.test(s) ? Number(s) : Object.hasOwn(SERVICES, s) ? SERVICES[s] ?? NaN : NaN);
    const [a, b] = range ? [port(range[1] ?? ''), port(range[2] ?? '')] : [port(w), port(w)];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 65535 || a > b) throw new NftSyntaxError(`Error: Could not resolve service: Servname not supported for ai_socktype`, t);
    return range ? { kind: 'range', from: a, to: b } : { kind: 'num', n: a };
  }
  const allowed: readonly string[] = kind === 'proto' ? PROTOCOLS : kind === 'state' ? CT_STATES : ICMP_TYPES;
  if (!allowed.includes(w)) throw unexpected(t);
  return { kind: 'word', w };
}

/** A value, an anonymous set `{ a, b }` or a comma list (`established,related`). */
function value(c: Cursor, kind: Kind): Value {
  if (c.eat('{')) {
    const items: Value[] = [];
    while (!c.eat('}')) {
      const t = c.next();
      if (t?.kind === 'newline') continue; // sets may span lines, as in most nftables.conf files
      if (!t || t.text === ';') throw unexpected(t);
      if (t.text !== ',') items.push(scalar(kind, t));
      if (items.length > NFT_LIMITS.setItems) throw new NftSyntaxError('Error: set too large', t);
    }
    return { kind: 'set', items };
  }
  const t = c.next();
  if (!t || t.kind === 'newline' || t.kind === 'punct') throw unexpected(t);
  const items = [scalar(kind, t)];
  // `ct state established,related`: a comma list without braces.
  while (c.peek()?.text === ',' && c.peek()?.kind === 'punct') {
    c.next();
    const n = c.next();
    if (!n || n.kind === 'newline' || n.kind === 'punct') throw unexpected(n);
    items.push(scalar(kind, n));
    if (items.length > NFT_LIMITS.setItems) throw new NftSyntaxError('Error: set too large', n);
  }
  return items.length === 1 ? (items[0] as Value) : { kind: 'set', items };
}

/** The field a match starts with, or null when the token starts a statement. */
function field(c: Cursor): Field | null {
  const a = c.peek()?.text ?? '';
  const b = c.peek(1)?.text ?? '';
  const two = `${a} ${b}` as Field;
  if (a === 'meta' && (b === 'iifname' || b === 'oifname' || b === 'iif' || b === 'oif')) {
    c.next();
    c.next();
    return b;
  }
  if (two in FIELD_KIND) {
    c.next();
    c.next();
    return two;
  }
  if (a === 'iif' || a === 'oif' || a === 'iifname' || a === 'oifname') {
    c.next();
    return a;
  }
  return null;
}

function address(c: Cursor): { ip: number; port?: number } {
  const t = c.next();
  const [ip, port] = (t?.text ?? '').split(':');
  const addr = parseIp(ip ?? '');
  const p = port === undefined ? undefined : Number(port);
  if (!t || addr === null || (p !== undefined && (!Number.isInteger(p) || p < 1 || p > 65535))) throw unexpected(t);
  return p === undefined ? { ip: addr } : { ip: addr, port: p };
}

function reject(c: Cursor): Verdict {
  if (!c.eat('with')) return { kind: 'reject' };
  if (c.eat('tcp')) {
    if (!c.eat('reset')) throw unexpected(c.peek());
    return { kind: 'reject', with: 'tcp reset' };
  }
  if (!c.eat('icmp') && !c.eat('icmpx')) throw unexpected(c.peek());
  c.eat('type');
  const t = c.next();
  const map: Readonly<Record<string, 'icmp port-unreachable' | 'icmp host-unreachable' | 'icmp admin-prohibited'>> = {
    'port-unreachable': 'icmp port-unreachable', 'host-unreachable': 'icmp host-unreachable', 'admin-prohibited': 'icmp admin-prohibited',
  };
  const w = t && Object.hasOwn(map, t.text) ? map[t.text] : undefined;
  if (!w) throw unexpected(t);
  return { kind: 'reject', with: w };
}

function verdict(c: Cursor, word: string): Verdict | null {
  if (word === 'accept' || word === 'drop' || word === 'return' || word === 'masquerade') return { kind: word };
  if (word === 'reject') return reject(c);
  if (word === 'jump' || word === 'goto') {
    const t = c.next();
    if (!t || t.kind !== 'word') throw unexpected(t);
    return { kind: word, chain: t.text };
  }
  if (word === 'snat' || word === 'dnat') {
    c.eat('ip');
    if (!c.eat('to')) throw unexpected(c.peek());
    return { kind: word, ...address(c) };
  }
  return null;
}

/** Statements after the matches: counter, log, comment and the final verdict. */
function statement(c: Cursor, draft: { counter: boolean; log?: string; comment?: string; verdict?: Verdict }): void {
  const t = c.next();
  const w = t?.text ?? '';
  // Only a comment may follow the verdict (that is also where `nft list` prints it).
  if (draft.verdict && w !== 'comment') throw unexpected(t);
  if (w === 'counter') {
    draft.counter = true;
    if (c.eat('packets')) { c.next(); if (!c.eat('bytes')) throw unexpected(c.peek()); c.next(); }
  } else if (w === 'log') {
    draft.log = '';
    if (c.eat('prefix')) draft.log = c.next()?.text ?? '';
    if (c.eat('level')) c.next();
  } else if (w === 'comment') {
    const s = c.next();
    if (!s || s.kind !== 'string') throw unexpected(s);
    draft.comment = s.text;
  } else {
    const v = t?.kind === 'word' ? verdict(c, w) : null;
    if (!v) throw unexpected(t);
    draft.verdict = v;
  }
}

/** Parses a rule body up to the end of the statement (newline, `;` or `}`); the handle is assigned later. */
export function parseRuleBody(c: Cursor): Omit<Rule, 'handle'> {
  const matches: Match[] = [];
  const draft: { counter: boolean; log?: string; comment?: string; verdict?: Verdict } = { counter: false };
  if (c.atEnd()) throw unexpected(c.peek());
  while (!c.atEnd()) {
    const f = draft.verdict || draft.counter || draft.log !== undefined || draft.comment !== undefined ? null : field(c);
    if (!f) {
      statement(c, draft);
      continue;
    }
    const negate = c.eat('!=');
    matches.push({ field: f, negate, value: value(c, FIELD_KIND[f]) });
  }
  return { matches, counter: draft.counter, log: draft.log, verdict: draft.verdict, comment: draft.comment };
}
