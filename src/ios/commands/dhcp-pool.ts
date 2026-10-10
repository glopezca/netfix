/** `(dhcp-config)#` and `(config-dhcp-pool-class)#` commands. */
import type { CommandDef, Match } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { parseIp, parseMask, networkOf, formatIp, inSubnet } from '../../core/ip.ts';
import { parseMac, parseHexId, asciiToHex } from '../../core/mac.ts';
import type { PoolConfig, PoolOption, Reservation } from '../../dhcp/pool.ts';
import { defaultHostPrefix, poolNetworks } from '../../dhcp/pool.ts';
import { endConfig } from './common.ts';

type Def = CommandDef<Cli<Router>>;
type PoolChange = (pool: PoolConfig) => PoolConfig;

const NETWORK_POOL_ONLY = '% This command may not be used with host pools.';
const HOST_POOL_CONFLICT = '% This command may not be used with network, origin or vrf pools.';

function currentPool(cli: Cli<Router>): PoolConfig | undefined {
  return cli.session.pool ? cli.device.dhcp.pool(cli.session.pool) : undefined;
}

function update(cli: Cli<Router>, change: PoolChange): void {
  const pool = currentPool(cli);
  if (pool) cli.device.dhcp.savePool(change(pool));
}

function ipList(m: Match, name: string): number[] {
  return m.all(name).map((s) => parseIp(s) ?? 0);
}

/** Helper for the many "set / clear" commands. */
function setter(syntax: string, set: (m: Match) => Partial<PoolConfig>, clear: Partial<PoolConfig>, help?: Record<string, string>): Def {
  return {
    syntax,
    help,
    run: (cli, m) => update(cli, (p) => ({ ...p, ...set(m) })),
    noRun: (cli) => update(cli, (p) => ({ ...p, ...clear })),
  };
}

function setNetwork(cli: Cli<Router>, m: Match): void {
  const pool = currentPool(cli);
  const ip = parseIp(m.get('net') ?? '');
  if (!pool || ip === null) return;
  if (pool.host) {
    cli.out(NETWORK_POOL_ONLY);
    return;
  }
  const prefix = m.get('mask') ? parseMask(m.get('mask') ?? '') ?? defaultHostPrefix(ip) : defaultHostPrefix(ip);
  const net = { ip: networkOf(ip, prefix), prefix };
  if (m.has('secondary')) {
    if (!pool.network) {
      cli.out('% Primary network must be configured first.');
      return;
    }
    update(cli, (p) => ({ ...p, secondaryNetworks: [...p.secondaryNetworks.filter((s) => s.ip !== net.ip), net] }));
    return;
  }
  update(cli, (p) => ({ ...p, network: net }));
}

function clearNetwork(cli: Cli<Router>, m: Match): void {
  const ip = parseIp(m.get('net') ?? '');
  if (m.has('secondary') && ip !== null) {
    update(cli, (p) => ({ ...p, secondaryNetworks: p.secondaryNetworks.filter((s) => s.ip !== ip) }));
    return;
  }
  update(cli, (p) => ({ ...p, network: undefined, secondaryNetworks: [] }));
}

function setHost(cli: Cli<Router>, m: Match): void {
  const pool = currentPool(cli);
  const ip = parseIp(m.get('ip') ?? '');
  if (!pool || ip === null) return;
  if (pool.network || pool.origin || pool.vrf) {
    cli.out(HOST_POOL_CONFLICT);
    return;
  }
  const prefix = m.get('mask') ? parseMask(m.get('mask') ?? '') ?? defaultHostPrefix(ip) : defaultHostPrefix(ip);
  update(cli, (p) => ({ ...p, host: { ip, prefix } }));
}

function setReservation(cli: Cli<Router>, m: Match): void {
  const pool = currentPool(cli);
  const ip = parseIp(m.get('ip') ?? '');
  if (!pool || ip === null) return;
  if (pool.host || !pool.network) {
    cli.out(pool.host ? NETWORK_POOL_ONLY : '% Network must be configured before reserving addresses.');
    return;
  }
  if (!poolNetworks(pool).some((n) => inSubnet(ip, n.ip, n.prefix))) {
    cli.out(`% ${formatIp(ip)} is not in the pool's network`);
    return;
  }
  const reservation = buildReservation(m, ip);
  if (!reservation) {
    cli.out("% Invalid input detected at '^' marker.", '');
    return;
  }
  update(cli, (p) => ({ ...p, reservations: [...p.reservations.filter((r) => r.ip !== ip), reservation] }));
}

function buildReservation(m: Match, ip: number): Reservation | null {
  if (m.has('hardware-address')) {
    const mac = parseMac(m.get('mac') ?? '');
    return mac ? { ip, mac, hwType: m.get('hwtype') } : null;
  }
  const raw = m.get('id') ?? '';
  if (m.has('ascii')) return { ip, clientId: asciiToHex(raw), asciiText: raw };
  const hex = parseHexId(raw);
  return hex ? { ip, clientId: hex } : null;
}

function setOption(cli: Cli<Router>, m: Match): void {
  const code = Number(m.get('code'));
  const instance = m.get('inst') !== undefined ? Number(m.get('inst')) : undefined;
  let option: PoolOption;
  if (m.has('ip')) option = { code, instance, kind: 'ip', value: '', ips: ipList(m, 'ips') };
  else if (m.has('hex')) {
    const hex = parseHexId((m.get('hex') ?? '').replace(/\s+/g, ''));
    if (!hex) {
      cli.out('% Invalid hex value');
      return;
    }
    option = { code, instance, kind: 'hex', value: (m.get('hex') ?? '').trim() };
  } else option = { code, instance, kind: 'ascii', value: m.get('text') ?? '' };
  update(cli, (p) => ({ ...p, options: [...p.options.filter((o) => o.code !== code), option] }));
}

function setLease(m: Match): Partial<PoolConfig> {
  if (m.has('infinite')) return { lease: 'infinite' };
  return { lease: { days: Number(m.get('days') ?? 0), hours: Number(m.get('hours') ?? 0), minutes: Number(m.get('mins') ?? 0) } };
}

function setMark(m: Match): Partial<PoolConfig> {
  const mark = { percent: Number(m.get('pct')), log: m.has('log') };
  return m.has('high') ? { utilizationHigh: mark } : { utilizationLow: mark };
}

function enterClass(cli: Cli<Router>, name: string): void {
  update(cli, (p) => (p.classes.some((c) => c.name === name) ? p : { ...p, classes: [...p.classes, { name, ranges: [] }] }));
  cli.session.poolClass = name;
  cli.session.enterMode('dhcp-class');
}

const NODE_TYPES = ['b-node', 'p-node', 'm-node', 'h-node'];

export const DHCP_POOL: readonly Def[] = [
  { syntax: 'exit', run: (cli) => { cli.session.pool = undefined; cli.session.enterMode('config'); } },
  { syntax: 'end', run: (cli) => endConfig(cli) },
  { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') },
  {
    syntax: 'network <A.B.C.D:net> [<MASK:mask>] [secondary]',
    help: { net: 'Network number in dotted-decimal notation', mask: 'Network mask or prefix length' },
    run: setNetwork,
    noRun: clearNetwork,
  },
  {
    syntax: 'host <A.B.C.D:ip> [<MASK:mask>]',
    help: { ip: 'IP address in dotted-decimal notation', mask: 'Network mask or prefix length' },
    run: setHost,
    noRun: (cli) => update(cli, (p) => ({ ...p, host: undefined })),
  },
  setter('client-identifier <HEX:id>', (m) => ({ clientIdentifier: parseHexId(m.get('id') ?? '') ?? undefined }), { clientIdentifier: undefined },
    { id: 'Dotted-hexadecimal string' }),
  setter('hardware-address <H.H.H:mac> [<HWTYPE:type>]',
    (m) => ({ hardwareAddress: { mac: parseMac(m.get('mac') ?? '') ?? '', type: normalizeHwType(m.get('type')) } }),
    { hardwareAddress: undefined }, { mac: 'Dotted-hexadecimal string', type: 'Hardware type (ethernet, ieee802 or number)' }),
  setter('client-name <WORD:name>', (m) => ({ clientName: m.get('name') }), { clientName: undefined }, { name: 'Client name' }),
  {
    syntax: 'address <A.B.C.D:ip> {client-id <WORD:id> [ascii] | hardware-address <H.H.H:mac> [<HWTYPE:hwtype>]}',
    help: { ip: 'IP address to reserve', id: 'Client identifier (dotted hex, or text with ascii)', mac: 'Hardware address' },
    run: setReservation,
    noRun: (cli, m) => {
      const ip = parseIp(m.get('ip') ?? '');
      update(cli, (p) => ({ ...p, reservations: ip === null ? [] : p.reservations.filter((r) => r.ip !== ip) }));
    },
  },
  setter('reserved-only', () => ({ reservedOnly: true }), { reservedOnly: false }),
  setter('default-router <A.B.C.D...:ips>', (m) => ({ defaultRouters: ipList(m, 'ips') }), { defaultRouters: [] }, { ips: 'Router\'s IP address' }),
  setter('dns-server <A.B.C.D...:ips>', (m) => ({ dnsServers: ipList(m, 'ips') }), { dnsServers: [] }, { ips: 'Server\'s IP address' }),
  setter('netbios-name-server <A.B.C.D...:ips>', (m) => ({ netbiosServers: ipList(m, 'ips') }), { netbiosServers: [] }, { ips: 'Server\'s IP address' }),
  setter('next-server <A.B.C.D...:ips>', (m) => ({ nextServers: ipList(m, 'ips') }), { nextServers: [] }, { ips: 'Server\'s IP address' }),
  setter('domain-name <WORD:name>', (m) => ({ domainName: m.get('name') }), { domainName: undefined }, { name: 'Domain name' }),
  setter('netbios-node-type {b-node | p-node | m-node | h-node | <WORD:hex>}',
    (m) => ({ netbiosNodeType: NODE_TYPES.find((t) => m.has(t)) ?? m.get('hex') }), { netbiosNodeType: undefined }, { hex: 'Hexadecimal number' }),
  setter('lease {<0-365:days> [<0-23:hours> [<0-59:mins>]] | infinite}', setLease, { lease: undefined },
    { days: 'Days', hours: 'Hours', mins: 'Minutes' }),
  setter('bootfile <WORD:file>', (m) => ({ bootfile: m.get('file') }), { bootfile: undefined }, { file: 'Boot file name' }),
  {
    syntax: 'option <0-254:code> [instance <0-255:inst>] {ascii <LINE:text> | hex <LINE:hex> | ip <A.B.C.D...:ips>}',
    help: { code: 'DHCP option code', inst: 'Instance number', text: 'ASCII string', hex: 'Dotted hexadecimal string', ips: 'Server\'s IP address' },
    run: setOption,
    noRun: (cli, m) => {
      const code = Number(m.get('code'));
      update(cli, (p) => ({ ...p, options: p.options.filter((o) => o.code !== code) }));
    },
  },
  { syntax: 'class <WORD:name>', help: { name: 'Class name' }, run: (cli, m) => enterClass(cli, m.get('name') ?? ''),
    noRun: (cli, m) => update(cli, (p) => ({ ...p, classes: p.classes.filter((c) => c.name !== m.get('name')) })) },
  setter('origin {dhcp [<LINE:dhcpopts>] | ipcp | file <WORD:url>}', (m) => ({ origin: originText(m) }), { origin: undefined }),
  setter('import all', () => ({ importAll: true }), { importAll: false }),
  setter('update arp', () => ({ updateArp: true }), { updateArp: false }, { arp: 'Install secure ARP entries' }),
  setter('renew deny unknown', () => ({ renewDenyUnknown: true }), { renewDenyUnknown: false }),
  {
    syntax: 'utilization mark {high | low} <1-100:pct> [log]',
    help: { pct: 'Utilization percentage', log: 'Enable syslog message' },
    run: (cli, m) => update(cli, (p) => ({ ...p, ...setMark(m) })),
    noRun: (cli, m) => update(cli, (p) => (m.has('low') ? { ...p, utilizationLow: undefined } : { ...p, utilizationHigh: undefined })),
  },
  setter('subnet prefix-length <1-31:len>', (m) => ({ subnetPrefixLength: Number(m.get('len')) }), { subnetPrefixLength: undefined }),
  setter('vrf <WORD:name>', (m) => ({ vrf: m.get('name') }), { vrf: undefined }, { name: 'VPN Routing/Forwarding instance name' }),
  setter('accounting <WORD:list>', (m) => ({ accounting: m.get('list') }), { accounting: undefined }, { list: 'Method list name' }),
  {
    syntax: 'relay {source <A.B.C.D:sip> <A.B.C.D:smask> | destination <A.B.C.D:dip>}',
    run: (cli, m) => update(cli, (p) => relayChange(p, m, true)),
    noRun: (cli, m) => update(cli, (p) => relayChange(p, m, false)),
  },
];

function originText(m: Match): string {
  if (m.has('ipcp')) return 'ipcp';
  if (m.has('file')) return `file ${m.get('url') ?? ''}`;
  const opts = m.get('dhcpopts');
  return opts ? `dhcp ${opts}` : 'dhcp';
}

function relayChange(p: PoolConfig, m: Match, add: boolean): PoolConfig {
  if (m.has('destination')) {
    const ip = parseIp(m.get('dip') ?? '') ?? 0;
    const rest = p.relayDestinations.filter((d) => d !== ip);
    return { ...p, relayDestinations: add ? [...rest, ip] : rest };
  }
  const ip = parseIp(m.get('sip') ?? '') ?? 0;
  const prefix = parseMask(m.get('smask') ?? '') ?? 32;
  const rest = p.relaySources.filter((s) => s.ip !== ip);
  return { ...p, relaySources: add ? [...rest, { ip, prefix }] : rest };
}

function normalizeHwType(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return text;
  return ['ethernet', 'ieee802'].find((t) => t.startsWith(text.toLowerCase()));
}

export const DHCP_CLASS: readonly Def[] = [
  {
    syntax: 'address range <A.B.C.D:start> <A.B.C.D:end>',
    help: { range: 'Configure a range of addresses', start: 'Start of range', end: 'End of range' },
    run: (cli, m) => {
      const start = parseIp(m.get('start') ?? '') ?? 0;
      const end = parseIp(m.get('end') ?? '') ?? 0;
      if (end < start) {
        cli.out('% Invalid address range.');
        return;
      }
      const name = cli.session.poolClass;
      update(cli, (p) => ({ ...p, classes: p.classes.map((c) => (c.name === name ? { ...c, ranges: [...c.ranges, { start, end }] } : c)) }));
    },
    noRun: (cli) => {
      const name = cli.session.poolClass;
      update(cli, (p) => ({ ...p, classes: p.classes.map((c) => (c.name === name ? { ...c, ranges: [] } : c)) }));
    },
  },
  { syntax: 'exit', run: (cli) => { cli.session.poolClass = undefined; cli.session.enterMode('dhcp-config'); } },
  { syntax: 'end', run: (cli) => endConfig(cli) },
];
