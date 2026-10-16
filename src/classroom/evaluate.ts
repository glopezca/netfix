/**
 * Headless marking: loads a topology file (as `Topology.fromJSON`, which settles the network) and runs each check
 * of a validated checklist inside the simulation (pings, DNS and HTTP really travel through the network). Needs no
 * DOM, so the classroom server can run it in a Worker. A check never throws: it fails with a reason.
 */
import { Topology } from '../net/topology.ts';
import { withWorkLimit, WorkLimitError } from '../net/network.ts';
import { checkMarkingBudget } from './budget.ts';
import type { AnyDevice } from '../net/topology.ts';
import { Host } from '../devices/host.ts';
import { Router } from '../devices/router.ts';
import { Switch } from '../devices/switch.ts';
import { IosDevice } from '../ios/device.ts';
import { parseIp, formatIp } from '../core/ip.ts';
import { runPing } from '../net/ping.ts';
import { resolveHost, httpRequest } from '../shells/net-tools.ts';
import { hostSystem } from '../shells/host-system.ts';
import type { Check, ChecklistItem } from './checklist.ts';

export interface ItemResult {
  readonly id: string;
  readonly title?: string;
  readonly weight: number;
  readonly passed: boolean;
  /** Why it passed or failed, for the student and the teacher. */
  readonly detail: string;
}

export interface Evaluation {
  readonly score: number;
  readonly max: number;
  readonly items: readonly ItemResult[];
}

type Outcome = { readonly passed: boolean; readonly detail: string };

const PING_COUNT = 3;
const PING_TIMEOUT_MS = 2000;
const HTTP_ERROR = 400;
/**
 * Simulation tasks for one whole marking. A lab with every check needs a few hundred; a switching loop (no spanning
 * tree) floods without end, and the limit keeps it to well under a second of CPU.
 */
export const WORK_LIMIT = 50_000;
const TOO_COSTLY = 'La topología genera demasiado tráfico para corregirla (¿un bucle entre switches?).';

const pass = (detail: string): Outcome => ({ passed: true, detail });
const fail = (detail: string): Outcome => ({ passed: false, detail });

function load(file: unknown): Topology {
  checkMarkingBudget(file);
  try {
    return Topology.fromJSON(file);
  } catch (e) {
    if (e instanceof WorkLimitError) throw new Error(TOO_COSTLY);
    // Only the file's own validation messages are told; an internal error (TypeError…) says nothing about the code.
    throw new Error(`Topología no válida: ${e instanceof Error && e.constructor === Error ? e.message : 'formato inesperado'}`);
  }
}

function find(t: Topology, label: string): AnyDevice | Outcome {
  const found = [...t.placed.values()].filter((p) => p.label === label);
  if (found.length > 1) return fail(`Hay varios equipos llamados «${label}».`);
  return found[0]?.device ?? fail(`No existe el equipo «${label}».`);
}

function host(t: Topology, label: string): Host | Outcome {
  const d = find(t, label);
  if (!(d instanceof Host)) return 'passed' in d ? d : fail(`«${label}» no es un PC ni un servidor.`);
  return d;
}

function deviceCheck(t: Topology, c: Extract<Check, { type: 'device' }>): Outcome {
  const d = find(t, c.device);
  if ('passed' in d) return d;
  if (c.kind && d.kind !== c.kind) return fail(`«${c.device}» es de tipo ${d.kind}, no ${c.kind}.`);
  return pass(`Existe «${c.device}».`);
}

function linkCheck(t: Topology, c: Extract<Check, { type: 'link' }>): Outcome {
  const a = find(t, c.a);
  const b = find(t, c.b);
  if ('passed' in a) return a;
  if ('passed' in b) return b;
  const joined = t.net.links.some((l) => (l.a.device === a.id && l.b.device === b.id) || (l.a.device === b.id && l.b.device === a.id));
  return joined ? pass(`«${c.a}» y «${c.b}» están conectados.`) : fail(`No hay cable entre «${c.a}» y «${c.b}».`);
}

function inNetwork(ip: number, cidr: string): { readonly net: number; readonly prefix: number; readonly inside: boolean } {
  const [addr = '', len = '0'] = cidr.split('/');
  const prefix = Number(len);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const net = (parseIp(addr) ?? 0) & mask;
  return { net, prefix, inside: ((ip & mask) >>> 0) === net >>> 0 };
}

function ipCheck(t: Topology, c: Extract<Check, { type: 'ip' }>): Outcome {
  const h = host(t, c.device);
  if (!(h instanceof Host)) return h;
  const cfg = h.config;
  if (c.mode && cfg.mode !== c.mode) return fail(`«${c.device}» usa configuración ${cfg.mode === 'dhcp' ? 'DHCP' : 'estática'}.`);
  if (cfg.ip === undefined) return fail(`«${c.device}» no tiene dirección IP.`);
  const shown = `${formatIp(cfg.ip)}/${cfg.prefix ?? '?'}`;
  if (c.ip && cfg.ip !== parseIp(c.ip)) return fail(`«${c.device}» tiene ${shown}, no ${c.ip}.`);
  if (c.network) {
    const n = inNetwork(cfg.ip, c.network);
    if (!n.inside || cfg.prefix !== n.prefix) return fail(`«${c.device}» tiene ${shown}, fuera de ${c.network}.`);
  }
  if (c.gateway && cfg.gateway !== parseIp(c.gateway)) return fail(`La puerta de enlace de «${c.device}» no es ${c.gateway}.`);
  if (c.dns && cfg.dns !== parseIp(c.dns)) return fail(`El servidor DNS de «${c.device}» no es ${c.dns}.`);
  return pass(`«${c.device}» tiene ${shown}.`);
}

function pingTarget(d: AnyDevice, to: string): number | string {
  if (d instanceof Host) {
    const r = resolveHost(d, to);
    return r.kind === 'ip' ? r.ip : `No se resuelve «${to}» desde «${d.name}».`;
  }
  return parseIp(to) ?? `Desde un equipo IOS se hace ping a direcciones IP, no a «${to}».`;
}

function pingCheck(t: Topology, c: Extract<Check, { type: 'ping' }>): Outcome {
  const d = find(t, c.from);
  if ('passed' in d) return d;
  const pinger = d instanceof Host || d instanceof Switch ? d : d instanceof Router ? { stack: d.plane.stack, hooks: d.hooks } : null;
  if (!pinger) return fail(`No se puede hacer ping desde «${c.from}».`);
  const dst = pingTarget(d, c.to);
  if (typeof dst === 'string') return fail(dst);
  const outcomes = runPing(pinger.stack, pinger.hooks, dst, { count: PING_COUNT, timeoutMs: PING_TIMEOUT_MS });
  const replies = outcomes.filter((r) => r.kind === 'reply').length;
  // A block is a probe that left and got no answer: with no address or route nothing left, and that is no block.
  if (outcomes.every((r) => r.kind === 'noroute')) return fail(`«${c.from}» no puede enviar a ${c.to}: no tiene dirección o ruta.`);
  const what = replies > 0 ? `«${c.from}» llega a ${c.to} (${replies}/${PING_COUNT}).` : `«${c.from}» no llega a ${c.to}.`;
  return (c.expect === 'success') === (replies > 0) ? pass(what) : fail(what);
}

function dnsCheck(t: Topology, c: Extract<Check, { type: 'dns' }>): Outcome {
  const h = host(t, c.from);
  if (!(h instanceof Host)) return h;
  const r = resolveHost(h, c.name);
  if (r.kind !== 'ip') return fail(`«${c.from}» no resuelve ${c.name}.`);
  // /etc/hosts answers too, but the check is about the DNS service.
  if (!r.viaDns) return fail(`«${c.from}» resuelve ${c.name} sin DNS (por /etc/hosts).`);
  if (c.ip && r.ip !== parseIp(c.ip)) return fail(`«${c.from}» resuelve ${c.name} como ${formatIp(r.ip)}, no ${c.ip}.`);
  return pass(`«${c.from}» resuelve ${c.name} como ${formatIp(r.ip)}.`);
}

function httpCheck(t: Topology, c: Extract<Check, { type: 'http' }>): Outcome {
  const h = host(t, c.from);
  if (!(h instanceof Host)) return h;
  const r = httpRequest(h, c.url);
  if (r.kind !== 'ok') return fail(`«${c.from}» no obtiene ${c.url}: ${r.message}`);
  const st = r.response.status;
  if (c.status !== undefined ? st !== c.status : st >= HTTP_ERROR) return fail(`${c.url} responde ${st} ${r.response.reason}.`);
  if (c.contains && !r.response.body.includes(c.contains)) return fail(`La página ${c.url} no contiene «${c.contains}».`);
  return pass(`${c.url} responde ${st}.`);
}

function fileCheck(t: Topology, c: Extract<Check, { type: 'file' }>): Outcome {
  const h = host(t, c.device);
  if (!(h instanceof Host)) return h;
  let content: string;
  try {
    content = hostSystem(h).fs.readFile(c.path);
  } catch {
    return fail(`No existe el archivo ${c.path} en «${c.device}».`);
  }
  if (c.contains && !content.includes(c.contains)) return fail(`${c.path} no contiene «${c.contains}».`);
  return pass(`Existe ${c.path} en «${c.device}».`);
}

/** The indented lines under the unindented line `head` (undefined when it is not there). */
function section(lines: readonly string[], head: string): string[] | undefined {
  const at = lines.findIndex((l) => l.trim() === head.trim() && !/^\s/.test(l));
  if (at < 0) return undefined;
  const end = lines.findIndex((l, i) => i > at && !/^\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

function configCheck(t: Topology, c: Extract<Check, { type: 'config' }>): Outcome {
  const d = find(t, c.device);
  if ('passed' in d) return d;
  if (!(d instanceof IosDevice)) return fail(`«${c.device}» no es un router ni un switch.`);
  const scope = c.section === undefined ? d.runningConfig() : section(d.runningConfig(), c.section);
  if (!scope) return fail(`No hay «${c.section}» en la configuración de «${c.device}».`);
  const running = new Set(scope.map((l) => l.trim()));
  const missing = c.lines.filter((l) => !running.has(l.trim()));
  return missing.length ? fail(`Falta en la configuración de «${c.device}»: ${missing.map((l) => l.trim()).join(' | ')}`) : pass(`La configuración de «${c.device}» es correcta.`);
}

function run(t: Topology, c: Check): Outcome {
  switch (c.type) {
    case 'device': return deviceCheck(t, c);
    case 'link': return linkCheck(t, c);
    case 'ip': return ipCheck(t, c);
    case 'ping': return pingCheck(t, c);
    case 'dns': return dnsCheck(t, c);
    case 'http': return httpCheck(t, c);
    case 'file': return fileCheck(t, c);
    case 'config': return configCheck(t, c);
  }
}

function safeRun(t: Topology, c: Check): Outcome {
  try {
    return run(t, c);
  } catch (e) {
    return fail(e instanceof WorkLimitError ? TOO_COSTLY : 'No se pudo comprobar este elemento.');
  }
}

/** Marks `file` (a topology file, untrusted) against a checklist already validated with `parseChecklist`, within a work limit. */
export function evaluate(file: unknown, checklist: readonly ChecklistItem[], workLimit = WORK_LIMIT): Evaluation {
  return withWorkLimit(workLimit, () => mark(file, checklist));
}

/** Checks that send traffic and advance the simulated time; they run after the rest, so order never changes a mark. */
const ACTIVE: ReadonlySet<Check['type']> = new Set(['ping', 'dns', 'http']);

function mark(file: unknown, checklist: readonly ChecklistItem[]): Evaluation {
  const t = load(file);
  const outcomes = new Map<ChecklistItem, Outcome>();
  for (const it of checklist) if (!ACTIVE.has(it.check.type)) outcomes.set(it, safeRun(t, it.check));
  for (const it of checklist) if (ACTIVE.has(it.check.type)) outcomes.set(it, safeRun(t, it.check));
  const items = checklist.map((it): ItemResult => ({ id: it.id, ...(it.title ? { title: it.title } : {}), weight: it.weight, ...(outcomes.get(it) ?? fail('')) }));
  return {
    score: items.reduce((n, i) => n + (i.passed ? i.weight : 0), 0),
    max: items.reduce((n, i) => n + i.weight, 0),
    items,
  };
}
