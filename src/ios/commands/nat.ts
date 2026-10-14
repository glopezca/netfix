/** NAT commands of the router (config, interface and EXEC); ACLs are in acl.ts. */
import type { CommandDef, Match } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { parseIp, parseMask } from '../../core/ip.ts';
import { parseIfaceName } from '../interfaces.ts';
import { sameStatic, showNatStatistics, showNatTranslations } from '../nat-config.ts';
import type { NatConfig, NatStaticRule } from '../nat-config.ts';
import { poolInUse, resolvedStatics } from '../../devices/router-nat.ts';

type Def = CommandDef<Cli<Router>>;

function setNat(cli: Cli<Router>, change: (n: NatConfig) => NatConfig): void {
  cli.device.nat = change(cli.device.nat);
}

function ifaceName(cli: Cli<Router>, text: string | undefined): string | undefined {
  const full = parseIfaceName(text ?? '')?.full;
  if (full && cli.device.iface(full)) return full;
  cli.out('% Invalid input detected.');
  return undefined;
}

function staticRule(cli: Cli<Router>, m: Match): NatStaticRule | undefined {
  const local = parseIp(m.get('local') ?? '');
  const global = m.get('global') ? parseIp(m.get('global') ?? '') ?? undefined : undefined;
  const globalIface = m.get('gif') ? ifaceName(cli, m.get('gif')) : undefined;
  if (local === null || (global === undefined && globalIface === undefined)) return undefined;
  const proto = m.has('tcp') ? 'tcp' : m.has('udp') ? 'udp' : undefined;
  return { local, global, globalIface, proto, localPort: proto ? Number(m.get('lport')) : undefined, globalPort: proto ? Number(m.get('gport')) : undefined };
}

function dynamicRule(cli: Cli<Router>, m: Match): void {
  const acl = m.get('acl') ?? '';
  const iface = m.get('iface') ? ifaceName(cli, m.get('iface')) : undefined;
  if (m.get('iface') && !iface) return;
  const pool = m.get('pool');
  if (pool && !cli.device.nat.pools.some((p) => p.name === pool)) return cli.out(`%Pool ${pool} not found`);
  const rule = { acl, iface, pool, overload: m.has('overload') || iface !== undefined };
  // a rule for the same list is replaced in place: the order of evaluation does not change
  setNat(cli, (n) => ({ ...n, dynamic: n.dynamic.some((d) => d.acl === acl) ? n.dynamic.map((d) => (d.acl === acl ? rule : d)) : [...n.dynamic, rule] }));
}

function addPool(cli: Cli<Router>, m: Match): void {
  const start = parseIp(m.get('start') ?? '');
  const end = parseIp(m.get('end') ?? '');
  const prefix = m.get('mask') ? parseMask(m.get('mask') ?? '') : Number(m.get('len'));
  if (start === null || end === null || prefix === null || end < start) return cli.out('%End address less than start address');
  const pool = { name: m.get('name') ?? '', start, end, prefix };
  setNat(cli, (n) => ({ ...n, pools: [...n.pools.filter((p) => p.name !== pool.name), pool] }));
}

export const NAT_GLOBAL: readonly Def[] = [
  { syntax: 'ip nat pool <WORD:name> <A.B.C.D:start> <A.B.C.D:end> {netmask <A.B.C.D:mask> | prefix-length <1-32:len>}', run: addPool, noRun: (cli, m) => setNat(cli, (n) => ({ ...n, pools: n.pools.filter((p) => p.name !== m.get('name')) })) },
  {
    syntax: 'ip nat inside source list <WORD:acl> {interface <IFACE:iface> | pool <WORD:pool>} [overload]',
    run: dynamicRule,
    noRun: (cli, m) => setNat(cli, (n) => ({ ...n, dynamic: n.dynamic.filter((d) => d.acl !== m.get('acl')) })),
  },
  {
    syntax: 'ip nat inside source static <A.B.C.D:local> {<A.B.C.D:global> | interface <IFACE:gif>}',
    run: (cli, m) => { const r = staticRule(cli, m); if (r) setNat(cli, (n) => ({ ...n, statics: [...n.statics.filter((s) => !sameStatic(s, r)), r] })); },
    noRun: (cli, m) => { const r = staticRule(cli, m); if (r) setNat(cli, (n) => ({ ...n, statics: n.statics.filter((s) => !sameStatic(s, r)) })); },
  },
  {
    syntax: 'ip nat inside source static {tcp | udp} <A.B.C.D:local> <1-65535:lport> {<A.B.C.D:global> | interface <IFACE:gif>} <1-65535:gport>',
    run: (cli, m) => { const r = staticRule(cli, m); if (r) setNat(cli, (n) => ({ ...n, statics: [...n.statics.filter((s) => !sameStatic(s, r)), r] })); },
    noRun: (cli, m) => { const r = staticRule(cli, m); if (r) setNat(cli, (n) => ({ ...n, statics: n.statics.filter((s) => !sameStatic(s, r)) })); },
  },
];

export const NAT_IF: readonly Def[] = [
  {
    syntax: 'ip nat {inside | outside}',
    run: (cli, m) => cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => ({ ...c, nat: m.has('inside') ? 'inside' : 'outside' }))),
    noRun: (cli) => cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => ({ ...c, nat: undefined }))),
  },
];

function natStatistics(cli: Cli<Router>): string[] {
  const r = cli.device;
  const by = (role: 'inside' | 'outside'): string[] => r.sortedIfaceNames().filter((n) => r.iface(n)?.nat === role);
  return showNatStatistics({ table: r.natTable, statics: resolvedStatics(r), inside: by('inside'), outside: by('outside'), nat: r.nat, poolUse: (p) => poolInUse(r, p) });
}

export const NAT_EXEC: readonly Def[] = [
  { syntax: 'show ip nat translations [verbose]', run: (cli) => cli.out(...showNatTranslations(cli.device.natTable.entries(), resolvedStatics(cli.device))) },
  { syntax: 'show ip nat statistics', run: (cli) => cli.out(...natStatistics(cli)) },
];

export const NAT_PRIV: readonly Def[] = [
  ...NAT_EXEC,
  {
    syntax: 'clear ip nat translation <WORD:all>',
    run: (cli, m) => {
      if (m.get('all') === '*') cli.device.natTable.clear();
      else cli.out("% Invalid input detected at '^' marker.");
    },
  },
  { syntax: 'clear ip nat statistics', run: (cli) => { cli.device.natTable.hits = 0; cli.device.natTable.misses = 0; } },
  { syntax: 'debug ip nat', run: (cli) => { cli.device.debugNat = true; cli.out('IP NAT debugging is on'); } },
  { syntax: '{no debug ip nat | undebug ip nat}', run: (cli) => { cli.device.debugNat = false; cli.out('IP NAT debugging is off'); } },
];
