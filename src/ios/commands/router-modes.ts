/** Mode table for routers. */
import type { CommandDef } from '../parser.ts';
import type { Cli, ModeTable } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { EXEC_USER, EXEC_PRIV, GLOBAL, LINE_MODE } from './common.ts';
import { ROUTER_IF, ROUTER_SUBIF } from './iface.ts';
import { parseIp, parseMask, networkOf } from '../../core/ip.ts';
import { parseIfaceName } from '../interfaces.ts';
import { buildRoutingTable, showIpRoute } from '../../net/routing.ts';
import { DHCP_GLOBAL } from './dhcp-global.ts';
import { DHCP_POOL, DHCP_CLASS } from './dhcp-pool.ts';
import { DHCP_EXEC_USER, DHCP_EXEC_PRIV } from './dhcp-exec.ts';

type Def = CommandDef<Cli<Router>>;

const DEFAULT_STATIC_DISTANCE = 1;

const ROUTER_EXEC: readonly Def[] = [
  { syntax: 'show ip route', run: (cli) => cli.out(...showIpRoute(buildRoutingTable(cli.device, cli.device.staticRoutes))) },
];

const ROUTER_GLOBAL: readonly Def[] = [
  {
    syntax: 'ip route <A.B.C.D:net> <A.B.C.D:mask> {<A.B.C.D:hop> | <IFACE:iface>} [<1-255:ad>]',
    help: { net: 'Destination prefix', mask: 'Destination prefix mask', hop: 'Forwarding router\'s address', ad: 'Distance metric for this route' },
    run: (cli, m) => {
      const net = parseIp(m.get('net') ?? '');
      const prefix = parseMask(m.get('mask') ?? '');
      if (net === null || prefix === null) return;
      if (networkOf(net, prefix) !== net) {
        cli.out('%Inconsistent address and mask');
        return;
      }
      const hop = m.get('hop') ? parseIp(m.get('hop') ?? '') ?? undefined : undefined;
      const iface = m.get('iface') ? parseIfaceName(m.get('iface') ?? '')?.full : undefined;
      if (!hop && !iface) return;
      const route = { network: net, prefix, nextHop: hop, iface, distance: Number(m.get('ad') ?? DEFAULT_STATIC_DISTANCE) };
      const others = cli.device.staticRoutes.filter((r) => !(r.network === net && r.prefix === prefix && r.nextHop === hop && r.iface === iface));
      cli.device.staticRoutes = [...others, route];
    },
    noRun: (cli, m) => {
      const net = parseIp(m.get('net') ?? '');
      const prefix = parseMask(m.get('mask') ?? '');
      cli.device.staticRoutes = cli.device.staticRoutes.filter((r) => net !== null && !(r.network === net && (prefix === null || r.prefix === prefix)));
    },
  },
  { syntax: 'ip routing', run: () => undefined, noRun: () => undefined },
];

export const routerModeTable: ModeTable<Router> = {
  user: [...EXEC_USER, ...DHCP_EXEC_USER],
  exec: [...EXEC_PRIV, ...ROUTER_EXEC, ...DHCP_EXEC_PRIV],
  config: [...GLOBAL, ...ROUTER_GLOBAL, ...DHCP_GLOBAL],
  'config-if': [...ROUTER_IF],
  'config-subif': [...ROUTER_SUBIF],
  'config-if-range': [...ROUTER_IF],
  'config-line': [...LINE_MODE],
  'dhcp-config': [...DHCP_POOL],
  'dhcp-class': [...DHCP_CLASS],
};
