/**
 * Checklist of a classroom assignment: the items the marking checks on the student's topology, each with an id, a
 * weight and one check. It arrives as untrusted JSON (written by a teacher, stored by the server), so every field is
 * validated and bounded; text is compared literally (no regular expressions, so no ReDoS).
 */
import type { DeviceKind } from '../net/topology.ts';
import { parseIp } from '../core/ip.ts';
import { DEVICE_KINDS } from './restrictions.ts';

export type Check =
  | { readonly type: 'device'; readonly device: string; readonly kind?: DeviceKind }
  | { readonly type: 'link'; readonly a: string; readonly b: string }
  | { readonly type: 'ip'; readonly device: string; readonly mode?: 'static' | 'dhcp'; readonly ip?: string; readonly network?: string; readonly gateway?: string; readonly dns?: string }
  | { readonly type: 'ping'; readonly from: string; readonly to: string; readonly expect: 'success' | 'fail' }
  | { readonly type: 'dns'; readonly from: string; readonly name: string; readonly ip?: string; readonly expect?: 'success' | 'fail' }
  /** A TCP connect (SYN, SYN-ACK) to a port: `success` when it opens, `fail` when it is closed or filtered. */
  | { readonly type: 'tcp'; readonly from: string; readonly to: string; readonly port: number; readonly expect: 'success' | 'fail' }
  /** A read-only `show …` command run on an IOS device: its output must contain the text. */
  | { readonly type: 'output'; readonly device: string; readonly command: string; readonly contains: string }
  | { readonly type: 'http'; readonly from: string; readonly url: string; readonly status?: number; readonly contains?: string }
  | { readonly type: 'file'; readonly device: string; readonly path: string; readonly contains?: string }
  /** `section`: the lines must be inside it (the indented lines under that unindented line, e.g. an interface). */
  | { readonly type: 'config'; readonly device: string; readonly section?: string; readonly lines: readonly string[] };

export interface ChecklistItem {
  readonly id: string;
  readonly title?: string;
  readonly weight: number;
  readonly check: Check;
}

export const MAX_ITEMS = 200;
const MAX_WEIGHT = 100;
const MAX_TEXT = 500;
const MAX_LINES = 50;
const MAX_PREFIX = 32;
const MAX_PORT = 65535;
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** Text without control or format characters (bidi overrides, zero width…) or line separators: shown to students. */
const VISIBLE = '[^\\p{Cc}\\p{Cf}\\u2028\\u2029]';
const LABEL_RE = new RegExp(`^${VISIBLE}{1,64}$`, 'u');
const LINE_RE = new RegExp(`^${VISIBLE}+$`, 'u');
const NAME_RE = /^[A-Za-z0-9.-]{1,253}$/;

type Field = (v: unknown, at: string) => unknown;

function invalid(why: string): never {
  throw new Error(`Lista de comprobación no válida: ${why}`);
}

const text = (re: RegExp | null, max = MAX_TEXT): Field => (v, at) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max || (re && !re.test(v))) invalid(`${at} no es válido`);
  return v;
};
const oneOf = (values: readonly string[]): Field => (v, at) => {
  if (typeof v !== 'string' || !values.includes(v)) invalid(`${at} debe ser ${values.join(' o ')}`);
  return v;
};
const ipText: Field = (v, at) => {
  if (typeof v !== 'string' || parseIp(v) === null) invalid(`${at} no es una dirección IPv4`);
  return v;
};
const cidr: Field = (v, at) => {
  const [addr, len, ...rest] = typeof v === 'string' ? v.split('/') : [];
  const n = Number(len);
  if (rest.length || addr === undefined || parseIp(addr) === null || !/^\d{1,2}$/.test(len ?? '') || n > MAX_PREFIX) invalid(`${at} debe ser red/prefijo`);
  return v;
};
const httpUrl: Field = (v, at) => {
  if (typeof v !== 'string' || v.length > MAX_TEXT || !/^http:\/\/[^\s/]+(\/\S*)?$/.test(v)) invalid(`${at} debe ser una URL http://`);
  return v;
};
const status: Field = (v, at) => {
  if (!Number.isInteger(v) || (v as number) < 100 || (v as number) > 599) invalid(`${at} debe ser un código HTTP`);
  return v;
};
const configLine = text(LINE_RE);
const lines: Field = (v, at) => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LINES) invalid(`${at} debe tener entre 1 y ${MAX_LINES} líneas`);
  return Object.freeze(v.map((l, i) => configLine(l, `${at}[${i}]`)));
};

const label = text(LABEL_RE);
const plain = text(LINE_RE, 200);
/** A DNS name to look up: an IP literal would "resolve" without asking any server. */
const dnsName: Field = (v, at) => {
  if (typeof v === 'string' && parseIp(v) !== null) invalid(`${at} debe ser un nombre, no una dirección IP`);
  return text(NAME_RE)(v, at);
};
const path = text(/^\/[^\u0000-\u001f]*$/, 256);
const port: Field = (v, at) => {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_PORT) invalid(`${at} debe ser un puerto de 1 a ${MAX_PORT}`);
  return v;
};
/** Only show commands: a checklist reads the device, it never configures it. */
const showCommand: Field = (v, at) => {
  const cmd = text(LINE_RE, 200)(v, at) as string;
  if (!/^sh(o(w)?)? \S/.test(cmd)) invalid(`${at} debe ser una orden show`);
  return cmd;
};
const expect = oneOf(['success', 'fail']);

/** Fields of each check type: required (no `?`) and optional (`?` suffix). */
const SCHEMAS: Readonly<Record<Check['type'], Readonly<Record<string, Field>>>> = {
  device: { device: label, 'kind?': oneOf(DEVICE_KINDS) },
  link: { a: label, b: label },
  ip: { device: label, 'mode?': oneOf(['static', 'dhcp']), 'ip?': ipText, 'network?': cidr, 'gateway?': ipText, 'dns?': ipText },
  ping: { from: label, to: text(NAME_RE), 'expect?': expect },
  dns: { from: label, name: dnsName, 'ip?': ipText, 'expect?': expect },
  tcp: { from: label, to: text(NAME_RE), port, 'expect?': expect },
  output: { device: label, command: showCommand, contains: text(null) },
  http: { from: label, url: httpUrl, 'status?': status, 'contains?': text(null) },
  file: { device: label, path, 'contains?': text(null) },
  config: { device: label, 'section?': configLine, lines },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isType(v: unknown): v is Check['type'] {
  return typeof v === 'string' && Object.hasOwn(SCHEMAS, v);
}

function parseCheck(v: unknown, at: string): Check {
  if (!isRecord(v) || !isType(v.type)) invalid(`${at}.type desconocido`);
  const schema = SCHEMAS[v.type];
  const out: Record<string, unknown> = { type: v.type };
  const names = new Set(Object.keys(schema).map((k) => k.replace(/\?$/, '')));
  const extra = Object.keys(v).find((k) => k !== 'type' && !names.has(k));
  if (extra) invalid(`${at}: campo desconocido «${extra}»`);
  for (const [key, field] of Object.entries(schema)) {
    const name = key.replace(/\?$/, '');
    if (v[name] === undefined) {
      if (!key.endsWith('?')) invalid(`${at}.${name} es obligatorio`);
      continue;
    }
    out[name] = field(v[name], `${at}.${name}`);
  }
  if (v.type === 'ping' || v.type === 'tcp') out.expect ??= 'success';
  return Object.freeze(out) as Check;
}

function parseItem(v: unknown, i: number, seen: Set<string>): ChecklistItem {
  const at = `[${i}]`;
  if (!isRecord(v)) invalid(`${at} debe ser un objeto`);
  const extra = Object.keys(v).find((k) => !['id', 'title', 'weight', 'check'].includes(k));
  if (extra) invalid(`${at}: campo desconocido «${extra}»`);
  const id = text(ID_RE)(v.id, `${at}.id`) as string;
  if (seen.has(id)) invalid(`id repetido «${id}»`);
  seen.add(id);
  const weight = v.weight ?? 1;
  if (!Number.isInteger(weight) || (weight as number) < 0 || (weight as number) > MAX_WEIGHT) invalid(`${at}.weight debe ser un entero de 0 a ${MAX_WEIGHT}`);
  const title = v.title === undefined ? undefined : (plain(v.title, `${at}.title`) as string);
  return Object.freeze({ id, weight: weight as number, check: parseCheck(v.check, `${at}.check`), ...(title ? { title } : {}) });
}

/** The checklist in `input` (JSON already parsed), validated: a list of 1 to 200 items with unique ids. */
export function parseChecklist(input: unknown): readonly ChecklistItem[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ITEMS) invalid(`se esperaba una lista de 1 a ${MAX_ITEMS} elementos`);
  const seen = new Set<string>();
  return Object.freeze(input.map((v, i) => parseItem(v, i, seen)));
}
