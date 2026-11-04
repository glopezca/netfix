/**
 * named-checkconf (BIND 9.20): la gramática de named.conf (options, zone, acl y los bloques que no se comprueban), las
 * comprobaciones de después (ACL sin definir, zonas sin tipo, sin archivo o repetidas) y, con -z, la carga de prueba
 * de cada zona primaria con zone-check.ts. Lo usan named-checkconf y el arranque de bind9.
 */
import {
  aml, bool, ConfError, duration, fail, hosts, int, iplist, lex, listen, near, oneOf, qstring, rpz, semicolon, skip, Stream,
} from './named-conf-parse.ts';
import type { AclRef, ConfReader, Ctx, Tok, Value } from './named-conf-parse.ts';
import { checkZone } from './zone-check.ts';
import { absolute, bare } from './zone-parse.ts';

export interface ConfZone {
  readonly name: string;
  readonly type?: string;
  readonly file?: string;
  /** «ARCHIVO:LÍNEA» de la sentencia zone. */
  readonly where: string;
}

export interface NamedConf {
  readonly errors: readonly string[];
  readonly zones: readonly ConfZone[];
  readonly directory?: string;
}

const yesNo = ['yes', 'no'];
const skipped = (names: readonly string[]): Record<string, Value> => Object.fromEntries(names.map((n) => [n, skip]));

/** Valid in both options and zone (BIND 9.20); read without checking the value. */
const ZONE_TUNING = [
  'check-integrity', 'check-mx', 'check-mx-cname', 'check-srv-cname', 'check-sibling', 'check-spf', 'check-wildcard',
  'check-dup-records', 'check-svcb', 'ixfr-from-differences', 'max-zone-ttl', 'notify-delay', 'notify-to-soa',
  'request-ixfr', 'request-expire', 'max-refresh-time', 'min-refresh-time', 'max-retry-time', 'min-retry-time',
  'max-transfer-time-in', 'max-transfer-time-out', 'max-transfer-idle-in', 'max-transfer-idle-out', 'min-transfer-rate-in',
  'multi-master', 'try-tcp-refresh', 'zero-no-soa-ttl', 'sig-validity-interval', 'sig-signing-nodes',
  'sig-signing-signatures', 'sig-signing-type', 'dnskey-sig-validity', 'dnssec-loadkeys-interval', 'dnssec-update-mode',
  'update-check-ksk', 'max-ixfr-ratio', 'max-records', 'max-records-per-type', 'max-types-per-name', 'dialup',
  'notify-source-v6', 'transfer-source-v6', 'parental-agents', 'parental-source', 'parental-source-v6', 'checkds',
  'max-journal-size', 'serial-update-method', 'provide-ixfr', 'update-quota', 'allow-query-on',
];
/** Valid only in options. */
const SERVER_TUNING = [
  'stale-cache-enable', 'stale-answer-ttl', 'stale-answer-client-timeout', 'stale-refresh-time', 'transfers-per-ns',
  'notify-rate', 'startup-notify-rate', 'dnssec-accept-expired', 'dnssec-must-be-secure', 'nocookie-udp-size',
  'send-cookie', 'require-server-cookie', 'answer-cookie', 'cookie-algorithm', 'cookie-secret', 'max-recursion-depth',
  'max-recursion-queries', 'max-query-count', 'max-query-restarts', 'fetches-per-server', 'fetches-per-zone',
  'fetch-quota-params', 'lmdb-mapsize', 'new-zones-directory', 'nta-lifetime', 'nta-recheck', 'preferred-glue',
  'root-key-sentinel', 'synth-from-dnssec', 'trust-anchor-telemetry', 'udp-receive-buffer', 'udp-send-buffer',
  'disable-algorithms', 'disable-ds-digests', 'disable-empty-zone', 'empty-server', 'empty-contact',
  'flush-zones-on-shutdown', 'geoip-directory', 'match-mapped-addresses', 'memstatistics', 'memstatistics-file', 'port',
  'heartbeat-interval', 'ipv4only-enable', 'ipv4only-server', 'ipv4only-contact', 'recursing-file', 'secroots-file',
  'tcp-advertised-timeout', 'tcp-idle-timeout', 'tcp-initial-timeout', 'tcp-keepalive-timeout', 'tcp-listen-queue',
  'tcp-receive-buffer', 'tcp-send-buffer', 'tls-port', 'https-port', 'http-port', 'http-listener-clients',
  'http-streams-per-connection', 'transfer-message-size', 'use-v4-udp-ports', 'use-v6-udp-ports', 'avoid-v4-udp-ports',
  'avoid-v6-udp-ports', 'reserved-sockets', 'resolver-nonbackoff-tries', 'resolver-retry-interval', 'validate-except',
  'max-validations-per-fetch', 'max-validation-failures-per-fetch', 'catalog-zones', 'deny-answer-addresses',
  'deny-answer-aliases', 'automatic-interface-scan', 'responselog', 'dnstap', 'dnstap-output', 'dnstap-identity',
  'dnstap-version', 'v6-bias', 'zero-no-soa-ttl-cache',
];

const OPTIONS: Readonly<Record<string, Value>> = {
  ...skipped(ZONE_TUNING), ...skipped(SERVER_TUNING),
  directory: qstring, 'pid-file': qstring, version: qstring, hostname: qstring, 'server-id': qstring,
  'dump-file': qstring, 'statistics-file': qstring, 'key-directory': qstring, 'managed-keys-directory': qstring,
  'session-keyfile': qstring, 'bindkeys-file': qstring, 'dnssec-policy': qstring,
  'max-cache-ttl': duration, 'max-ncache-ttl': duration, 'min-cache-ttl': duration, 'min-ncache-ttl': duration,
  'lame-ttl': duration, 'servfail-ttl': duration, 'max-stale-ttl': duration, 'interface-interval': duration,
  forwarders: iplist, 'also-notify': hosts, forward: oneOf('only', 'first'),
  recursion: bool, 'auth-nxdomain': bool, querylog: bool, 'empty-zones-enable': bool, 'minimal-any': bool,
  'stale-answer-enable': bool, 'zone-statistics': bool, 'allow-new-zones': bool,
  notify: oneOf(...yesNo, 'explicit', 'master-only', 'primary-only'),
  'minimal-responses': oneOf(...yesNo, 'no-auth', 'no-auth-recursive'),
  'dnssec-validation': oneOf(...yesNo, 'auto'),
  'qname-minimization': oneOf('strict', 'relaxed', 'disabled', 'off'),
  'allow-recursion': aml, 'allow-recursion-on': aml, 'allow-query': aml, 'allow-query-on': aml, 'allow-query-cache': aml,
  'allow-query-cache-on': aml, 'allow-transfer': aml, 'allow-update': aml, 'allow-update-forwarding': aml,
  'allow-notify': aml, blackhole: aml, sortlist: aml,
  'listen-on': listen, 'listen-on-v6': listen, 'response-policy': rpz,
  'max-cache-size': skip, 'check-names': skip, 'rate-limit': skip, 'transfer-source': skip, 'notify-source': skip,
  'query-source': skip, 'query-source-v6': skip, dns64: skip, 'rrset-order': skip, 'tcp-clients': int,
  'recursive-clients': int, 'clients-per-query': int, 'max-clients-per-query': int, 'edns-udp-size': int,
  'max-udp-size': int, prefetch: skip, 'transfers-in': int, 'transfers-out': int, 'transfer-format': skip,
  'serial-query-rate': int, 'resolver-query-timeout': int, 'masterfile-format': skip,
};

const ZONE: Readonly<Record<string, Value>> = {
  ...skipped(ZONE_TUNING), database: qstring, dlz: qstring, 'server-addresses': iplist, 'server-names': skip,
  type: oneOf('master', 'primary', 'slave', 'secondary', 'hint', 'forward', 'stub', 'mirror', 'static-stub', 'redirect'),
  file: qstring, journal: qstring, 'in-view': qstring, 'key-directory': qstring, 'dnssec-policy': qstring,
  'allow-query': aml, 'allow-query-on': aml, 'allow-transfer': aml, 'allow-update': aml, 'allow-notify': aml,
  'allow-update-forwarding': aml, primaries: hosts, masters: hosts, forwarders: iplist, forward: oneOf('only', 'first'),
  notify: oneOf(...yesNo, 'explicit', 'master-only', 'primary-only'), 'also-notify': hosts, 'inline-signing': bool,
  'zone-statistics': skip, 'update-policy': skip, 'check-names': skip, 'masterfile-format': skip,
  'max-journal-size': skip, 'notify-source': skip, 'transfer-source': skip, 'serial-update-method': skip,
};

/** Sentencias de primer nivel que se aceptan sin comprobar su contenido. */
const SKIPPED = new Set([
  'logging', 'controls', 'key', 'view', 'server', 'statistics-channels', 'trust-anchors', 'managed-keys', 'primaries',
  'masters', 'tls', 'http', 'dnssec-policy', 'remote-servers', 'key-store',
]);
const BUILTIN_ACLS = new Set(['any', 'none', 'localhost', 'localnets']);
const CLASSES = new Set(['in', 'ch', 'chaos', 'hs', 'hesiod']);
const NEEDS_FILE = new Set(['master', 'primary', 'hint']);
const NEEDS_PRIMARIES = new Set(['slave', 'secondary', 'stub']);
const LOADABLE = new Set(['master', 'primary']);

interface ZoneDef extends ConfZone { readonly seq: number; readonly primaries: boolean }
interface Parsed { readonly acls: Set<string>; readonly zones: ZoneDef[]; directory?: string }

/** El cuerpo de un bloque { … }: sentencias de su gramática hasta el `}`; devuelve los valores leídos. */
function mapBody(c: Ctx, grammar: Readonly<Record<string, Value>>): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  for (;;) {
    const t = c.s.next();
    if (t.kind === 'punct' && t.text === '}') return found;
    if (t.kind === 'eof') throw fail(t, 'unexpected end of input');
    const name = t.text.toLowerCase();
    const value = t.kind === 'word' && Object.hasOwn(grammar, name) ? grammar[name] : undefined;
    if (!value) throw fail(t, `unknown option ${near(t)}`);
    found.set(name, value(c));
    semicolon(c.s);
  }
}

function openBlock(s: Stream): void {
  const t = s.next();
  if (t.kind !== 'punct' || t.text !== '{') throw fail(t, `'{' expected near ${near(t)}`);
}

function zone(c: Ctx, at: Tok, p: Parsed): void {
  const seq = c.s.taken;
  const name = qstring(c) ?? '';
  const cls = c.s.peek();
  if (cls.kind === 'word' && CLASSES.has(cls.text.toLowerCase())) c.s.next();
  openBlock(c.s);
  const body = mapBody(c, ZONE);
  p.zones.push({
    name, type: body.get('type'), file: body.get('file'), where: `${at.file}:${at.line}`, seq,
    primaries: body.has('primaries') || body.has('masters'),
  });
}

function statement(c: Ctx, t: Tok, p: Parsed): void {
  const word = t.kind === 'word' ? t.text.toLowerCase() : '';
  if (word === 'options') {
    openBlock(c.s);
    const dir = mapBody(c, OPTIONS).get('directory');
    if (dir !== undefined) p.directory = dir;
  } else if (word === 'zone') zone(c, t, p);
  else if (word === 'acl') {
    p.acls.add((qstring(c) ?? '').toLowerCase());
    aml(c);
  } else if (SKIPPED.has(word)) skip(c);
  else throw fail(t, `unknown option ${near(t)}`);
  semicolon(c.s);
}

/** Lo que named-checkconf comprueba con el archivo ya leído; todos los errores, en el orden en que aparecen. */
function semantic(p: Parsed, refs: readonly AclRef[]): string[] {
  const found: { seq: number; message: string }[] = [];
  for (const r of refs) {
    const name = r.name.toLowerCase();
    if (!BUILTIN_ACLS.has(name) && !p.acls.has(name)) found.push({ seq: r.seq, message: `${r.tok.file}:${r.tok.line}: undefined ACL '${r.name}'` });
  }
  const seen = new Map<string, ZoneDef>();
  for (const z of p.zones) {
    const say = (what: string): void => { found.push({ seq: z.seq, message: `${z.where}: zone '${z.name}': ${what}` }); };
    if (z.type === undefined) say('type not present');
    else if (NEEDS_FILE.has(z.type) && z.file === undefined) say("missing 'file' entry");
    else if (NEEDS_PRIMARIES.has(z.type) && !z.primaries) say("missing 'primaries' entry");
    const key = absolute(z.name);
    const prev = seen.get(key);
    if (prev) say(`already exists previous definition: ${prev.where}`);
    else seen.set(key, z);
  }
  return found.sort((a, b) => a.seq - b.seq).map((f) => f.message);
}

/** Lee y comprueba named.conf con sus include, como `named-checkconf [archivo]`. */
export function checkNamedConf(path: string, read: ConfReader): NamedConf {
  const text = read(path);
  if (typeof text !== 'string') return { errors: [`none:0: open: ${path}: ${text.error}`], zones: [] };
  const p: Parsed = { acls: new Set(), zones: [] };
  const refs: AclRef[] = [];
  try {
    const c: Ctx = { s: new Stream(lex(text, path), read), refs };
    for (let t = c.s.next(); t.kind !== 'eof'; t = c.s.next()) statement(c, t, p);
  } catch (err) {
    if (err instanceof ConfError) return { errors: [err.message], zones: [] };
    throw err;
  }
  const zones = p.zones.map(({ name, type, file, where }) => ({ name, type, file, where }));
  return { errors: semantic(p, refs), zones, ...(p.directory === undefined ? {} : { directory: p.directory }) };
}

/** named-checkconf -z: carga cada zona primaria; un archivo relativo se lee desde `directory`. */
export function loadConfZones(conf: NamedConf, read: ConfReader): { readonly ok: boolean; readonly lines: readonly string[] } {
  const lines: string[] = [];
  let ok = true;
  const dir = conf.directory?.replace(/\/$/, '');
  // Zone files and their $INCLUDEs are relative to the working directory of named.
  const inDirectory: ConfReader = (file) => read(file.startsWith('/') || dir === undefined ? file : `${dir}/${file}`);
  for (const z of conf.zones) {
    if (z.type === undefined || !LOADABLE.has(z.type) || z.file === undefined) continue;
    const text = inDirectory(z.file);
    const r = typeof text === 'string' ? checkZone(z.name, z.file, text, undefined, inDirectory) : checkZone(z.name, z.file, undefined, text.error);
    lines.push(...r.lines);
    if (!r.ok) {
      ok = false;
      lines.push(`_default/${bare(absolute(z.name))}/IN: bad zone`);
    }
  }
  return { ok, lines };
}
