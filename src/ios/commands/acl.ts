/** IP access lists on the router: standard and extended, numbered and named, `ip access-group`, show and clear. */
import type { CommandDef, Match } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { isExtendedList, nextSeq, parseSource, showAccessLists } from '../acl.ts';
import type { AclEntry } from '../acl.ts';
import { parseExtended } from '../acl-ext.ts';
import type { AclProto } from '../acl-ext.ts';

type Def = CommandDef<Cli<Router>>;

const SOURCE = '{any | host <A.B.C.D:host> | <A.B.C.D:src> [<A.B.C.D:wc>]}';
const PROTO = '{ip | tcp | udp | icmp | esp | gre}';
const PROTO_HELP = { ip: 'Any Internet Protocol', tcp: 'Transmission Control Protocol', udp: 'User Datagram Protocol', icmp: 'Internet Control Message Protocol', esp: 'Encapsulation Security Payload', gre: 'Cisco\'s GRE tunneling', rest: 'Source address and the rest of the entry' };

function sourceWords(m: Match): string[] {
  if (m.has('any')) return ['any'];
  if (m.get('host')) return ['host', m.get('host') ?? ''];
  return [m.get('src') ?? '', ...(m.get('wc') ? [m.get('wc') ?? ''] : [])];
}

function protoOf(m: Match): AclProto {
  return (['tcp', 'udp', 'icmp', 'esp', 'gre'] as const).find((p) => m.has(p)) ?? 'ip';
}

function store(cli: Cli<Router>, name: string, entry: AclEntry): void {
  const list = cli.device.acls.get(name) ?? [];
  const rest = list.filter((e) => e.seq !== entry.seq);
  cli.device.acls = new Map([...cli.device.acls, [name, [...rest, entry].sort((a, b) => a.seq - b.seq)]]);
}

function addStandard(cli: Cli<Router>, name: string, action: 'permit' | 'deny', m: Match, seq?: number): void {
  const src = parseSource(sourceWords(m));
  if (typeof src === 'string') return cli.out(src);
  store(cli, name, { seq: seq ?? nextSeq(cli.device.acls.get(name) ?? []), action, ...src });
}

function addExtended(cli: Cli<Router>, name: string, action: 'permit' | 'deny', m: Match, seq?: number): void {
  const r = parseExtended(protoOf(m), (m.get('rest') ?? '').trim().split(/\s+/).filter(Boolean));
  if (typeof r === 'string') return cli.out(r);
  store(cli, name, { seq: seq ?? nextSeq(cli.device.acls.get(name) ?? []), action, ...r.src, ext: r.ext });
}

function remark(cli: Cli<Router>, name: string, text: string | undefined): void {
  const list = cli.device.acls.get(name) ?? [];
  cli.device.acls = new Map([...cli.device.acls, [name, [...list, { seq: nextSeq(list), action: 'remark', ip: 0, wildcard: 0, remark: text }]]]);
}

function removeList(cli: Cli<Router>, name: string): void {
  const next = new Map(cli.device.acls);
  next.delete(name);
  cli.device.acls = next;
  cli.device.extendedAcls.delete(name);
  for (const key of [...cli.device.aclHits.keys()]) if (key.startsWith(`${name}:`)) cli.device.aclHits.delete(key);
}

function enterNamed(cli: Cli<Router>, name: string, extended: boolean): void {
  const exists = cli.device.acls.get(name);
  if (exists && isExtendedList(name, exists, cli.device.extendedAcls) !== extended) {
    cli.out(`% A named ${extended ? 'standard' : 'extended'} IP access list with this name already exists`);
    return;
  }
  if (!exists) cli.device.acls = new Map([...cli.device.acls, [name, []]]);
  if (extended) cli.device.extendedAcls.add(name);
  cli.session.acl = name;
  cli.session.enterMode(extended ? 'config-ext-nacl' : 'config-std-nacl');
}

const action = (m: Match): 'permit' | 'deny' => (m.has('permit') ? 'permit' : 'deny');

export const ACL_GLOBAL: readonly Def[] = [
  { syntax: `access-list <1-99:n> {permit | deny} ${SOURCE}`, run: (cli, m) => addStandard(cli, m.get('n') ?? '', action(m), m), noRun: (cli, m) => removeList(cli, m.get('n') ?? '') },
  { syntax: `access-list <100-199:n> {permit | deny} ${PROTO} <LINE:rest>`, help: PROTO_HELP, run: (cli, m) => addExtended(cli, m.get('n') ?? '', action(m), m), noRun: (cli, m) => removeList(cli, m.get('n') ?? '') },
  { syntax: 'access-list <1-199:n> remark <LINE:text>', run: (cli, m) => remark(cli, m.get('n') ?? '', m.get('text')) },
  { syntax: 'access-list <1-199:n>', run: (cli) => cli.out('% Incomplete command.'), noRun: (cli, m) => removeList(cli, m.get('n') ?? ''), hidden: true },
  { syntax: 'ip access-list standard <WORD:name>', run: (cli, m) => enterNamed(cli, m.get('name') ?? '', false), noRun: (cli, m) => removeList(cli, m.get('name') ?? '') },
  { syntax: 'ip access-list extended <WORD:name>', run: (cli, m) => enterNamed(cli, m.get('name') ?? '', true), noRun: (cli, m) => removeList(cli, m.get('name') ?? '') },
];

export const ACL_IF: readonly Def[] = [
  {
    syntax: 'ip access-group <WORD:acl> {in | out}',
    run: (cli, m) => cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => (m.has('in') ? { ...c, accessIn: m.get('acl') } : { ...c, accessOut: m.get('acl') }))),
    noRun: (cli, m) => cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => (m.has('in') ? { ...c, accessIn: undefined } : { ...c, accessOut: undefined }))),
  },
];

const aclName = (cli: Cli<Router>): string => cli.session.acl ?? '';

const deleteSeq: Def = {
  syntax: '<1-2147483647:seq>',
  run: (cli) => cli.out('% Incomplete command.'),
  noRun: (cli, m) => { cli.device.acls = new Map([...cli.device.acls, [aclName(cli), (cli.device.acls.get(aclName(cli)) ?? []).filter((e) => e.seq !== Number(m.get('seq')))]]); },
};

const leave: readonly Def[] = [
  { syntax: 'remark <LINE:text>', run: (cli, m) => remark(cli, aclName(cli), m.get('text')) },
  { syntax: 'exit', run: (cli) => { cli.session.acl = undefined; cli.session.enterMode('config'); } },
  { syntax: 'end', run: (cli) => cli.session.endConfig() },
  { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') },
];

export const ACL_MODE: readonly Def[] = [
  { syntax: `{permit | deny} ${SOURCE}`, run: (cli, m) => addStandard(cli, aclName(cli), action(m), m) },
  { syntax: `<1-2147483647:seq> {permit | deny} ${SOURCE}`, run: (cli, m) => addStandard(cli, aclName(cli), action(m), m, Number(m.get('seq'))) },
  deleteSeq, ...leave,
];

export const EXT_ACL_MODE: readonly Def[] = [
  { syntax: `{permit | deny} ${PROTO} <LINE:rest>`, help: PROTO_HELP, run: (cli, m) => addExtended(cli, aclName(cli), action(m), m) },
  { syntax: `<1-2147483647:seq> {permit | deny} ${PROTO} <LINE:rest>`, help: PROTO_HELP, run: (cli, m) => addExtended(cli, aclName(cli), action(m), m, Number(m.get('seq'))) },
  deleteSeq, ...leave,
];

export const ACL_EXEC: readonly Def[] = [
  {
    syntax: 'show {access-lists | ip access-lists} [<WORD:name>]',
    run: (cli, m) => {
      const name = m.get('name');
      const lists = name ? new Map([...cli.device.acls].filter(([n]) => n === name)) : cli.device.acls;
      cli.out(...showAccessLists(lists, cli.device.aclHits, cli.device.extendedAcls));
    },
  },
];

export const ACL_PRIV: readonly Def[] = [
  ...ACL_EXEC,
  { syntax: 'clear access-list counters', run: (cli) => cli.device.aclHits.clear() },
];
