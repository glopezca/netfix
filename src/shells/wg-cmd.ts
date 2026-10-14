/** wg (wireguard-tools 1.0): show, showconf, set, setconf/addconf/syncconf, genkey, genpsk, pubkey. */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { WgInterface } from '../devices/wireguard.ts';
import { formatWgConf, parseCidr, parseEndpoint, parseWgConf, WG_MAX_PEERS } from '../net/wg-config.ts';
import type { WgConfig, WgPeerConfig } from '../net/wg-config.ts';
import { decodeKey, encodeKey, genKey, pubKey, randomKey } from '../core/x25519.ts';
import { SHOW_FIELDS, showField, showLink } from './wg-format.ts';
import type { ShowField } from './wg-format.ts';
import { FsError } from '../bash/vfs.ts';

const USAGE = `Usage: wg <cmd> [<args>]

Available subcommands:
  show: Shows the current configuration and device information
  showconf: Shows the current configuration of a given WireGuard interface, for use with \`setconf'
  set: Change the current configuration, add peers, remove peers, or change peers
  setconf: Applies a configuration file to a WireGuard interface
  addconf: Appends a configuration file to a WireGuard interface
  syncconf: Synchronizes a configuration file to a WireGuard interface
  genkey: Generates a new private key and writes it to stdout
  genpsk: Generates a new preshared key and writes it to stdout
  pubkey: Reads a private key from stdin and writes a public key to stdout
You may pass \`--help' to any of these subcommands to view usage.
`;
const SET_USAGE = 'Usage: wg set <interface> [listen-port <port>] [fwmark <mark>] [private-key <file path>] [peer <base64 public key> [remove] [preshared-key <file path>] [endpoint <ip>:<port>] [persistent-keepalive <interval seconds>] [allowed-ips <ip1>/<cidr1>[,<ip2>/<cidr2>]...] ]...\n';

const out = (ctx: Ctx, lines: readonly string[]): void => {
  if (lines.length) ctx.out(`${lines.join('\n')}\n`);
};

export function readFileAs(ctx: Ctx, path: string): string | null {
  try {
    return ctx.sh.env.fs.readFile(ctx.resolve(path), ctx.cred);
  } catch (e) {
    if (e instanceof FsError) return null;
    throw e;
  }
}

/** The link, or null after printing wg's error (no device / not root). */
function linkOf(ctx: Ctx, host: Host, name: string | undefined): WgInterface | null {
  if (ctx.cred.uid !== 0) { ctx.err('Unable to access interface: Operation not permitted\n'); return null; }
  const link = name ? host.wgLinks()?.get(name) : undefined;
  if (!link) { ctx.err('Unable to access interface: No such device\n'); return null; }
  return link;
}

function show(ctx: Ctx, host: Host, args: readonly string[]): number {
  const links = [...(host.wgLinks()?.links.values() ?? [])];
  const target = args[0] ?? 'all';
  const field = args[1] as ShowField | undefined;
  if (field !== undefined && !SHOW_FIELDS.includes(field)) { ctx.err(`Usage: wg show { <interface> | all | interfaces } [public-key | private-key | listen-port | fwmark | peers | preshared-keys | endpoints | allowed-ips | latest-handshakes | transfer | persistent-keepalive | dump]\n`); return 1; }
  if (ctx.cred.uid !== 0) { ctx.err('Unable to access interface: Operation not permitted\n'); return 1; }
  if (target === 'interfaces') { out(ctx, links.length ? [links.map((l) => l.name).join(' ')] : []); return 0; }
  const chosen = target === 'all' ? links : links.filter((l) => l.name === target);
  if (target !== 'all' && !chosen.length) { ctx.err('Unable to access interface: No such device\n'); return 1; }
  const now = ctx.sh.env.now();
  const blocks = chosen.map((l) => (field ? showField(l, field, target === 'all') : showLink(l, now)));
  out(ctx, field ? blocks.flat() : blocks.flatMap((b, i) => (i ? ['', ...b] : b)));
  return 0;
}

function* pubkeyCmd(ctx: Ctx): Gen<number> {
  const text = (yield* ctx.readAll()).trim();
  const pub = pubKey(text);
  if (!pub) { ctx.err('pubkey: Key is not the correct length or format\n'); return 1; }
  ctx.out(`${pub}\n`);
  return 0;
}

function applyFile(ctx: Ctx, link: WgInterface, verb: string, path: string | undefined): number {
  if (path === undefined) { ctx.err(`Usage: wg ${verb} <interface> <configuration filename>\n`); return 1; }
  const text = readFileAs(ctx, path);
  if (text === null) { ctx.err(`fopen: No such file or directory\n`); return 1; }
  const parsed = parseWgConf(text, verb === 'syncconf' ? true : false);
  if (typeof parsed === 'string') { ctx.err(`${parsed}\n`); return 1; }
  const next = parsed.wg;
  if (verb === 'addconf') {
    const keep = link.config.peers.filter((p) => !next.peers.some((n) => n.publicKey === p.publicKey));
    link.setConfig({ privateKey: next.privateKey ?? link.config.privateKey, listenPort: next.listenPort ?? link.config.listenPort, peers: [...keep, ...next.peers].slice(0, WG_MAX_PEERS) });
  } else link.setConfig(next);
  return 0;
}

interface SetState {
  cfg: WgConfig;
  peer?: string;
}

function updatePeer(s: SetState, change: (p: WgPeerConfig) => WgPeerConfig): void {
  s.cfg = { ...s.cfg, peers: s.cfg.peers.map((p) => (p.publicKey === s.peer ? change(p) : p)) };
}

/** One `wg set` keyword with its value; returns an error message or null. */
function setWord(ctx: Ctx, s: SetState, word: string, value: string | undefined): string | null {
  if (word === 'peer') {
    if (!value || !decodeKey(value)) return `Key is not the correct length or format: \`${value ?? ''}'`;
    s.peer = value;
    if (!s.cfg.peers.some((p) => p.publicKey === value)) s.cfg = { ...s.cfg, peers: [...s.cfg.peers, { publicKey: value, allowedIps: [] }] };
    return null;
  }
  if (value === undefined) return SET_USAGE.trim();
  if (word === 'listen-port') return /^\d+$/.test(value) && Number(value) <= 65535 ? ((s.cfg = { ...s.cfg, listenPort: Number(value) }), null) : `Listen port is invalid: \`${value}'`;
  if (word === 'fwmark') return null;
  if (word === 'private-key' || word === 'preshared-key') {
    const key = readFileAs(ctx, value)?.trim();
    if (key === undefined || !decodeKey(key)) return `Key is not the correct length or format: \`${value}'`;
    if (word === 'private-key') s.cfg = { ...s.cfg, privateKey: key };
    else updatePeer(s, (p) => ({ ...p, presharedKey: key }));
    return null;
  }
  if (!s.peer) return SET_USAGE.trim();
  if (word === 'endpoint') {
    const ep = parseEndpoint(value);
    return ep ? (updatePeer(s, (p) => ({ ...p, endpoint: ep })), null) : `Name or service not known: \`${value}'`;
  }
  if (word === 'persistent-keepalive') {
    const n = value === 'off' ? 0 : Number(value);
    return /^(\d+|off)$/.test(value) && n <= 65535 ? (updatePeer(s, (p) => ({ ...p, keepalive: n || undefined })), null) : `Persistent keepalive interval is neither 0/off nor 1-65535: \`${value}'`;
  }
  if (word === 'allowed-ips') {
    const list = value.split(',').map((x) => x.trim()).filter(Boolean).map(parseCidr);
    if (list.some((c) => c === null)) return `Unable to parse IP address: \`${value}'`;
    updatePeer(s, (p) => ({ ...p, allowedIps: list.filter((c) => c !== null) }));
    return null;
  }
  return SET_USAGE.trim();
}

function setCmd(ctx: Ctx, link: WgInterface, args: readonly string[]): number {
  const s: SetState = { cfg: link.config };
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    if (word === 'remove') {
      if (!s.peer) { ctx.err(SET_USAGE); return 1; }
      s.cfg = { ...s.cfg, peers: s.cfg.peers.filter((p) => p.publicKey !== s.peer) };
      continue;
    }
    const err = setWord(ctx, s, word, args[i + 1]);
    if (err) { ctx.err(`${err}\n`); return 1; }
    i++;
  }
  if (s.cfg.peers.length > WG_MAX_PEERS) { ctx.err('Too many peers\n'); return 1; }
  link.setConfig(s.cfg);
  return 0;
}

export function wg(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    const [cmd = 'show', ...args] = ctx.argv.slice(1);
    if (cmd === 'genkey') { ctx.out(`${genKey()}\n`); return 0; }
    if (cmd === 'genpsk') { ctx.out(`${encodeKey(randomKey())}\n`); return 0; }
    if (cmd === 'pubkey') return yield* pubkeyCmd(ctx);
    if (cmd === 'show') return show(ctx, host, args);
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') { ctx.out(USAGE); return 0; }
    if (!['showconf', 'set', 'setconf', 'addconf', 'syncconf'].includes(cmd)) { ctx.err(`Invalid subcommand: \`${cmd}'\n${USAGE}`); return 1; }
    const link = linkOf(ctx, host, args[0]);
    if (!link) return 1;
    if (cmd === 'showconf') { out(ctx, formatWgConf(link.config)); return 0; }
    if (cmd === 'set') return setCmd(ctx, link, args.slice(1));
    return applyFile(ctx, link, cmd, args[1]);
  };
}
