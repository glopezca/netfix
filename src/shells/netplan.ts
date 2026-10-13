/**
 * netplan on Ubuntu hosts: /etc/netplan/*.yaml are real, editable files (merged in name order) and
 * `netplan apply|try|generate|get` turn them into the running configuration of eth0, which the GUI shows.
 * The text written by the user is kept while it still describes the running configuration.
 */
import type { Ctx, Gen } from '../bash/types.ts';
import type { Host, HostIpConfig } from '../devices/host.ts';
import { parseYaml, isYamlError } from '../core/yaml-lite.ts';
import type { YamlMap, YamlValue } from '../core/yaml-lite.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { readLineFrom } from '../bash/io.ts';
import { IFACE } from './linux-files.ts';

export const NETPLAN_DIR = '/etc/netplan';
export const NETPLAN_FILE = `${NETPLAN_DIR}/50-cloud-init.yaml`;
const DHCP_WAIT_MS = 20_000;
const MAX_FILES = 16;
const ETH_KEYS = new Set(['dhcp4', 'dhcp6', 'addresses', 'routes', 'gateway4', 'nameservers', 'optional', 'match', 'set-name', 'mtu', 'macaddress', 'renderer', 'link-local']);

type Wanted = { mode: 'dhcp' } | { mode: 'static'; ip?: number; prefix?: number; gateway?: number; dns?: number };

interface Stored {
  text: string;
  applied: boolean;
}

const stored = new WeakMap<Host, Stored>();

/** The canonical file for the running configuration (what cloud-init would write). */
export function generatedNetplan(c: HostIpConfig): string {
  if (c.mode === 'dhcp') return `network:\n  version: 2\n  ethernets:\n    ${IFACE}:\n      dhcp4: true\n`;
  const addr = c.ip !== undefined && c.prefix !== undefined ? `\n      addresses:\n        - ${formatIp(c.ip)}/${c.prefix}` : '';
  const gw = c.gateway !== undefined ? `\n      routes:\n        - to: default\n          via: ${formatIp(c.gateway)}` : '';
  const dns = c.dns !== undefined ? `\n      nameservers:\n        addresses: [${formatIp(c.dns)}]` : '';
  return `network:\n  version: 2\n  ethernets:\n    ${IFACE}:\n      dhcp4: false${addr}${gw}${dns}\n`;
}

// ------------------------------------------------------------ interpretation

const map = (v: YamlValue | undefined): YamlMap | undefined => (v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const list = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]);
const truthy = (v: YamlValue | undefined): boolean | null => (v === undefined ? false : typeof v !== 'string' ? null : /^(true|yes|on)$/i.test(v) ? true : /^(false|no|off)$/i.test(v) ? false : null);

/** Merges netplan documents: mappings key by key, sequences appended, scalars replaced. */
export function mergeNetplan(a: YamlMap, b: YamlMap): YamlMap {
  const out: Record<string, YamlValue> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    const pm = map(prev);
    const vm = map(v);
    out[k] = pm && vm ? mergeNetplan(pm, vm) : Array.isArray(prev) && Array.isArray(v) ? [...prev, ...v] : v;
  }
  return out;
}

function cidr(text: YamlValue): { ip: number; prefix: number } | null {
  const m = typeof text === 'string' ? /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(text) : null;
  const ip = m ? parseIp(m[1] ?? '') : null;
  return ip === null || Number(m?.[2]) > 32 ? null : { ip, prefix: Number(m?.[2]) };
}

function defaultVia(eth: YamlMap): { via?: number; error?: string } {
  let via: number | undefined;
  for (const r of list(eth.routes)) {
    const rm = map(r);
    if (!rm) return { error: 'expected mapping (routes)' };
    if (rm.to !== 'default' && rm.to !== '0.0.0.0/0') return { error: `Netfix hosts only use the default route (to: ${String(rm.to)})` };
    const gw = typeof rm.via === 'string' ? parseIp(rm.via) : null;
    if (gw === null) return { error: `invalid IPv4 address '${String(rm.via)}'` };
    via = gw;
  }
  if (typeof eth.gateway4 === 'string') via = parseIp(eth.gateway4) ?? via;
  return { via };
}

/** eth0's configuration in a merged document, an error, plus deprecation warnings. */
export function interpretNetplan(doc: YamlMap): { wanted: Wanted; warnings: string[] } | { error: string } {
  const net = map(doc.network);
  if (!net) return { error: 'Error in network definition: expected mapping (check indentation)' };
  if (net.version !== undefined && net.version !== '2') return { error: `Error in network definition: Only version 2 is supported` };
  const eths = map(net.ethernets) ?? {};
  const eth = map(eths[IFACE]);
  if (!eth) return { wanted: { mode: 'static' }, warnings: [] };
  const unknown = Object.keys(eth).find((k) => !ETH_KEYS.has(k));
  if (unknown) return { error: `Error in network definition: unknown key '${unknown}'` };
  const dhcp = truthy(eth.dhcp4);
  if (dhcp === null) return { error: `Error in network definition: invalid boolean value '${String(eth.dhcp4)}'` };
  const warnings = eth.gateway4 !== undefined ? ['`gateway4` has been deprecated, use default routes instead.\nSee the \'Default routes\' section of the documentation for more details.'] : [];
  if (dhcp) return { wanted: { mode: 'dhcp' }, warnings };
  const addrs = list(eth.addresses).map(cidr);
  if (addrs.some((a) => a === null)) return { error: `Error in network definition: malformed address '${String(list(eth.addresses)[addrs.indexOf(null)])}', must be X.X.X.X/NN or X:X:X:X:X:X:X:X/NN` };
  if (addrs.length > 1) return { error: `Netfix: one IPv4 address per interface (${IFACE} has ${addrs.length})` };
  const route = defaultVia(eth);
  if (route.error) return { error: `Error in network definition: ${route.error}` };
  const dnsText = list(map(eth.nameservers)?.addresses)[0];
  const dns = typeof dnsText === 'string' ? parseIp(dnsText) ?? undefined : undefined;
  const a = addrs[0];
  return { wanted: { mode: 'static', ip: a?.ip, prefix: a?.prefix, gateway: route.via, dns }, warnings };
}

function sameAs(w: Wanted, c: HostIpConfig): boolean {
  if (w.mode === 'dhcp' || c.mode === 'dhcp') return w.mode === c.mode;
  return w.ip === c.ip && w.prefix === c.prefix && w.gateway === c.gateway && w.dns === c.dns;
}

/** Content of /etc/netplan/50-cloud-init.yaml: the user's text while it matches (or awaits apply), else generated. */
export function netplanFileContent(host: Host): string {
  const s = stored.get(host);
  if (s) {
    const doc = parseYaml(s.text);
    const r = isYamlError(doc) ? null : interpretNetplan(doc);
    if (!s.applied || (r && 'wanted' in r && sameAs(r.wanted, host.config))) return s.text;
    stored.delete(host);
  }
  return generatedNetplan(host.config);
}

export function writeNetplanFile(host: Host, content: string): void {
  stored.set(host, { text: content, applied: false });
}

// ------------------------------------------------------------ netplan program

function yamlFiles(ctx: Ctx): string[] {
  const fs = ctx.sh.env.fs;
  if (fs.tryLookup(NETPLAN_DIR, ctx.cred)?.kind !== 'dir') return [];
  return fs.readdir(NETPLAN_DIR, ctx.cred).filter((n) => n.endsWith('.yaml')).sort().slice(0, MAX_FILES).map((n) => `${NETPLAN_DIR}/${n}`);
}

/** Reads and merges every file; prints errors like netplan (file:line:col). */
function load(ctx: Ctx): { wanted: Wanted; warnings: string[]; doc: YamlMap } | null {
  let doc: YamlMap = {};
  for (const path of yamlFiles(ctx)) {
    let text: string;
    try { text = ctx.sh.env.fs.readFile(path, ctx.cred); } catch { ctx.err(`${path}: Permission denied\n`); return null; }
    const parsed = parseYaml(text);
    if (isYamlError(parsed)) { ctx.err(`${path}:${parsed.line}:${parsed.col}: Invalid YAML: ${parsed.message}\n`); return null; }
    doc = mergeNetplan(doc, parsed);
  }
  const r = interpretNetplan(doc);
  if ('error' in r) { ctx.err(`${NETPLAN_FILE}:1:1: ${r.error}\n`); return null; }
  for (const w of r.warnings) ctx.err(`\n** (generate:1481): WARNING **: ${new Date(ctx.sh.env.now()).toISOString().slice(11, 23)}: ${w}\n`);
  return { ...r, doc };
}

function apply(host: Host, w: Wanted): void {
  if (w.mode === 'dhcp') {
    if (host.config.mode !== 'dhcp' || host.dhcpStatus !== 'ok') {
      host.useDhcp();
      host.hooks.runUntil(() => host.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    }
  } else host.setStatic({ ip: w.ip, prefix: w.prefix, gateway: w.gateway, dns: w.dns });
  const s = stored.get(host);
  if (s) s.applied = true;
}

function* tryConfig(ctx: Ctx, host: Host, w: Wanted): Gen<number> {
  const before = host.config;
  apply(host, w);
  ctx.out('Do you want to keep these settings?\n\n\nPress ENTER before the timeout to accept the new configuration\n\n\n');
  const answer = yield* readLineFrom({ kind: 'tty' }, 'Changes will revert in 120 seconds', false);
  if (answer !== null) { ctx.out('Configuration accepted.\n'); return 0; }
  apply(host, before.mode === 'dhcp' ? { mode: 'dhcp' } : { ...before, mode: 'static' });
  // The files keep the new text (it is the running config that goes back).
  const s = stored.get(host);
  if (s) s.applied = false;
  ctx.out('\nReverting.\n');
  return 1;
}

export function netplanProgram(host: Host) {
  return function* netplan(ctx: Ctx): Gen<number> {
    const verb = ctx.argv[1] ?? '';
    if (!['apply', 'try', 'generate', 'get', 'info'].includes(verb)) {
      ctx.err('usage: /usr/sbin/netplan  [-h] [--debug]  ...\n\nNetwork configuration in YAML\n\nAvailable commands:\n    help      Show this help message\n    apply     Apply current netplan config to running system\n    generate  Generate backend specific configuration files from /etc/netplan/*.yaml\n    get       Get a setting by specifying a nested key like "ethernets.eth0.addresses", or "all"\n    info      Show available features\n    try       Try to apply a new netplan config to running system, with automatic rollback\n');
      return verb === '' ? 1 : 2;
    }
    if (verb === 'info') { ctx.out('netplan.io:\n  website: https://netplan.io/\n  features:\n  - dhcp-use-domains\n  - default-routes\n'); return 0; }
    if (verb !== 'get' && ctx.cred.uid !== 0) { ctx.err('Permission denied (you must run netplan as root)\n'); return 1; }
    const r = load(ctx);
    if (!r) return 78;
    if (verb === 'generate') return 0;
    if (verb === 'get') { ctx.out(r.wanted.mode === 'dhcp' ? generatedNetplan({ mode: 'dhcp' }) : generatedNetplan(r.wanted)); return 0; }
    if (verb === 'try') return yield* tryConfig(ctx, host, r.wanted);
    apply(host, r.wanted);
    return 0;
  };
}
