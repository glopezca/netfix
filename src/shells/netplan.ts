/**
 * netplan on Ubuntu hosts: /etc/netplan/*.yaml are real, editable files (merged in name order) and
 * `netplan apply|try|generate|get` turn them into the running configuration of the NICs, which the GUI shows.
 * The text written by the user is kept while it still describes the running configuration.
 */
import type { Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { parseYaml, isYamlError } from '../core/yaml-lite.ts';
import type { YamlMap } from '../core/yaml-lite.ts';
import { readLineFrom } from '../bash/io.ts';
import { currentWanted, generatedNetplan, interpretNetplan, mergeNetplan, sameWanted } from './netplan-model.ts';
import type { Wanted } from './netplan-model.ts';

export const NETPLAN_DIR = '/etc/netplan';
export const NETPLAN_FILE = `${NETPLAN_DIR}/50-cloud-init.yaml`;
const DHCP_WAIT_MS = 20_000;
const MAX_FILES = 16;

interface Stored {
  text: string;
  applied: boolean;
}

const stored = new WeakMap<Host, Stored>();

const nicNames = (host: Host): string[] => host.nics().map((n) => n.linux);

/** Content of /etc/netplan/50-cloud-init.yaml: the user's text while it matches (or awaits apply), else generated. */
export function netplanFileContent(host: Host): string {
  const s = stored.get(host);
  if (s) {
    const doc = parseYaml(s.text);
    const r = isYamlError(doc) ? null : interpretNetplan(doc, nicNames(host));
    if (!s.applied || (r && 'wanted' in r && sameWanted(r.wanted, currentWanted(host)))) return s.text;
    stored.delete(host);
  }
  return generatedNetplan(currentWanted(host));
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
function load(ctx: Ctx, host: Host): { wanted: Wanted; warnings: string[]; doc: YamlMap } | null {
  let doc: YamlMap = {};
  for (const path of yamlFiles(ctx)) {
    let text: string;
    try { text = ctx.sh.env.fs.readFile(path, ctx.cred); } catch { ctx.err(`${path}: Permission denied\n`); return null; }
    const parsed = parseYaml(text);
    if (isYamlError(parsed)) { ctx.err(`${path}:${parsed.line}:${parsed.col}: Invalid YAML: ${parsed.message}\n`); return null; }
    doc = mergeNetplan(doc, parsed);
  }
  const r = interpretNetplan(doc, nicNames(host));
  if ('error' in r) { ctx.err(`${NETPLAN_FILE}:1:1: ${r.error}\n`); return null; }
  for (const w of r.warnings) ctx.err(`\n** (generate:1481): WARNING **: ${new Date(ctx.sh.env.now()).toISOString().slice(11, 23)}: ${w}\n`);
  return { ...r, doc };
}

/** Applies a configuration: DHCP or addresses per NIC, the default route and DNS on the first NIC, routes. */
function apply(host: Host, w: Wanted): void {
  const [primary, ...others] = host.nics();
  const first = primary ? w.nics[primary.linux] ?? { dhcp: false } : { dhcp: false };
  if (first.dhcp) {
    if (host.config.mode !== 'dhcp' || host.dhcpStatus !== 'ok') {
      host.useDhcp();
      host.hooks.runUntil(() => host.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    }
  } else host.setStatic({ ip: first.ip, prefix: first.prefix, gateway: w.gateway, dns: w.dns });
  for (const n of others) {
    const want = w.nics[n.linux];
    host.setNicAddress(n.port, want?.ip !== undefined && want.prefix !== undefined ? { ip: want.ip, prefix: want.prefix } : undefined);
  }
  host.setStaticRoutes(w.routes);
  host.dnsSearch = w.search;
  const s = stored.get(host);
  if (s) s.applied = true;
}

function* tryConfig(ctx: Ctx, host: Host, w: Wanted): Gen<number> {
  const before = currentWanted(host);
  apply(host, w);
  ctx.out('Do you want to keep these settings?\n\n\nPress ENTER before the timeout to accept the new configuration\n\n\n');
  const answer = yield* readLineFrom({ kind: 'tty' }, 'Changes will revert in 120 seconds', false);
  if (answer !== null) { ctx.out('Configuration accepted.\n'); return 0; }
  apply(host, before);
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
    const r = load(ctx, host);
    if (!r) return 78;
    if (verb === 'generate') return 0;
    if (verb === 'get') { ctx.out(generatedNetplan(r.wanted)); return 0; }
    if (verb === 'try') return yield* tryConfig(ctx, host, r.wanted);
    apply(host, r.wanted);
    return 0;
  };
}
