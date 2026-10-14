/**
 * wg-quick (wireguard-tools 1.0): up/down/strip/save for /etc/wireguard/IFACE.conf. It prints each
 * step as `[#] …` like the real script, runs Pre/PostUp and Pre/PostDown hooks with bash (%i = interface)
 * and installs a route per AllowedIPs network (0.0.0.0/0 as a full tunnel in table 51820).
 */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { WgManager } from '../devices/wg-manager.ts';
import { WG_TABLE } from '../devices/wg-manager.ts';
import { cidrText, formatWgConf, inCidr, networkCidr, parseWgConf } from '../net/wg-config.ts';
import type { Cidr, WgQuickConfig } from '../net/wg-config.ts';
import { readFileAs } from './wg-cmd.ts';

export const WG_DIR = '/etc/wireguard';
const USAGE = `Usage: wg-quick [ up | down | save | strip ] [ CONFIG_FILE | INTERFACE ]

  CONFIG_FILE is a configuration file, whose filename is the interface name
  followed by \`.conf'. Otherwise, INTERFACE is an interface name, with
  configuration found at ${WG_DIR}/INTERFACE.conf. It is to be readable
  by wg(8)'s \`setconf' sub-command, with the exception of the following additions
  to the [Interface] section, which are handled by wg-quick:

  - Address: may be specified one or more times and contains one or more
    IP addresses (with an optional CIDR mask) to be set for the interface.
  - DNS: an optional DNS server to use while the device is up.
  - MTU: an optional MTU for the interface; if unspecified, auto-calculated.
  - Table: an optional routing table to which routes will be added.
  - PreUp, PostUp, PreDown, PostDown: script snippets which will be executed
    by bash(1) at the corresponding phases of the link, most commonly used
    to configure DNS. The string \`%i' is expanded to INTERFACE.
  - SaveConfig: if set to \`true', the configuration is saved from the current
    state of the interface upon shutdown.
`;

interface Target {
  readonly name: string;
  readonly path: string;
}

function target(arg: string): Target | null {
  if (/^[a-zA-Z0-9_=+.-]{1,15}$/.test(arg)) return { name: arg, path: `${WG_DIR}/${arg}.conf` };
  const m = /(?:^|\/)([a-zA-Z0-9_=+.-]{1,15})\.conf$/.exec(arg);
  return m ? { name: m[1] ?? '', path: arg } : null;
}

const step = (ctx: Ctx, cmd: string): void => ctx.err(`[#] ${cmd}\n`);

function* hooks(ctx: Ctx, list: readonly string[], name: string): Gen<number> {
  for (const raw of list) {
    const cmd = raw.replace(/%i/g, name);
    step(ctx, cmd);
    const status = yield* ctx.sh.runSource(cmd, ctx.fds);
    if (status !== 0) return status;
  }
  return 0;
}

/** Routes for AllowedIPs, most specific first, skipping networks already reachable through wg0. */
function addRoutes(ctx: Ctx, wgm: WgManager, name: string, cfg: WgQuickConfig): boolean {
  const nets = cfg.wg.peers.flatMap((p) => p.allowedIps).map(networkCidr).sort((a, b) => b.prefix - a.prefix);
  const covered = (c: Cidr): boolean => cfg.addresses.some((a) => a.prefix <= c.prefix && inCidr(a, c.ip));
  let full = false;
  for (const c of nets) {
    if (c.prefix === 0) {
      full = true;
      continue;
    }
    if (covered(c) || wgm.devRoutes.some((r) => r.dev === name && r.net === c.ip && r.prefix === c.prefix)) continue;
    step(ctx, `ip -4 route add ${cidrText(c)} dev ${name}`);
    wgm.addRoute({ net: c.ip, prefix: c.prefix, dev: name });
  }
  if (full) {
    for (const line of [`wg set ${name} fwmark ${WG_TABLE}`, `ip -4 route add 0.0.0.0/0 dev ${name} table ${WG_TABLE}`, `ip -4 rule add not fwmark ${WG_TABLE} table ${WG_TABLE}`, 'ip -4 rule add table main suppress_prefixlength 0', 'sysctl -q net.ipv4.conf.all.src_valid_mark=1', 'nft -f /dev/fd/63']) step(ctx, line);
    wgm.addRoute({ net: 0, prefix: 0, dev: name, table: WG_TABLE });
  }
  return full;
}

function* up(ctx: Ctx, wgm: WgManager, t: Target, cfg: WgQuickConfig): Gen<number> {
  if (wgm.get(t.name)) { ctx.err(`wg-quick: \`${t.name}' already exists\n`); return 1; }
  if ((yield* hooks(ctx, cfg.hooks.preUp, t.name)) !== 0) return 1;
  step(ctx, `ip link add ${t.name} type wireguard`);
  const err = wgm.add(t.name);
  if (err) { ctx.err(`${err}\n`); return 1; }
  step(ctx, `wg setconf ${t.name} /dev/fd/63`);
  wgm.get(t.name)?.setConfig(cfg.wg);
  for (const a of cfg.addresses) {
    step(ctx, `ip -4 address add ${cidrText(a)} dev ${t.name}`);
    wgm.addAddress(t.name, a);
  }
  const link = wgm.get(t.name);
  if (link && cfg.mtu) link.mtu = cfg.mtu;
  step(ctx, `ip link set mtu ${link?.mtu ?? 1420} up dev ${t.name}`);
  wgm.setUp(t.name, true);
  addRoutes(ctx, wgm, t.name, cfg);
  return (yield* hooks(ctx, cfg.hooks.postUp, t.name)) === 0 ? 0 : 1;
}

function* down(ctx: Ctx, wgm: WgManager, t: Target, cfg: WgQuickConfig | null): Gen<number> {
  if (!wgm.get(t.name)) { ctx.err(`wg-quick: \`${t.name}' is not a WireGuard interface\n`); return 1; }
  yield* hooks(ctx, cfg?.hooks.preDown ?? [], t.name);
  const full = wgm.devRoutes.some((r) => r.dev === t.name && r.prefix === 0);
  step(ctx, `ip link delete dev ${t.name}`);
  wgm.remove(t.name);
  if (full) step(ctx, 'nft -f /dev/fd/63');
  yield* hooks(ctx, cfg?.hooks.postDown ?? [], t.name);
  return 0;
}

/** `wg-quick save`: the running interface written back, keeping the wg-quick-only keys. */
function save(ctx: Ctx, wgm: WgManager, t: Target, cfg: WgQuickConfig): number {
  const link = wgm.get(t.name);
  if (!link) { ctx.err(`wg-quick: \`${t.name}' is not a WireGuard interface\n`); return 1; }
  const [head = '[Interface]', ...rest] = formatWgConf(link.config);
  const extra = [
    ...link.addresses.map((a) => `Address = ${cidrText(a)}`),
    ...cfg.dns.map((d) => `DNS = ${d}`),
    ...(cfg.mtu ? [`MTU = ${cfg.mtu}`] : []),
    ...(cfg.saveConfig ? ['SaveConfig = true'] : []),
    ...cfg.hooks.preUp.map((h) => `PreUp = ${h}`), ...cfg.hooks.postUp.map((h) => `PostUp = ${h}`),
    ...cfg.hooks.preDown.map((h) => `PreDown = ${h}`), ...cfg.hooks.postDown.map((h) => `PostDown = ${h}`),
  ];
  ctx.sh.env.fs.writeFile(ctx.resolve(t.path), `${[head, ...extra, ...rest].join('\n')}\n`, ctx.cred, false, 0o600);
  return 0;
}

export function wgQuick(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    const [verb, arg] = ctx.argv.slice(1);
    if (!verb || !arg || !['up', 'down', 'save', 'strip'].includes(verb)) { ctx.err(USAGE); return 1; }
    if (ctx.cred.uid !== 0) { ctx.err('wg-quick must be run as root.\n'); return 1; }
    const wgm = host.wgLinks();
    const t = target(arg);
    if (!wgm || !t) { ctx.err(USAGE); return 1; }
    const text = readFileAs(ctx, t.path);
    if (text === null && verb !== 'down') { ctx.err(`wg-quick: \`${t.path}' does not exist\n`); return 1; }
    const cfg = text === null ? null : parseWgConf(text);
    if (typeof cfg === 'string') { ctx.err(`${cfg}\n`); return 1; }
    if (verb === 'down') return yield* down(ctx, wgm, t, cfg);
    if (!cfg) return 1;
    if (verb === 'strip') {
      const strip = /^\s*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)\s*=/i;
      ctx.out(`${(text ?? '').split('\n').filter((l) => !strip.test(l)).join('\n').replace(/\n*$/, '\n')}`);
      return 0;
    }
    if (verb === 'save') return save(ctx, wgm, t, cfg);
    return yield* up(ctx, wgm, t, cfg);
  };
}
