/**
 * The IOS HTTP server of routers and switches, like a real Cisco IOS 15 device:
 *   /                                 home page ("Accessing Cisco …")
 *   /level/N/exec/-/show/version/CR   runs an EXEC command at privilege level N (N ≤ user level)
 *   /level/N/exec/-[/words]           keyword help as links, plus a command box (?command=…)
 *   /level/15/configure/-             configuration commands (POST command=lines)
 *   /level/15/dm                      Device Manager: port panel and quick port settings
 * HTTP Basic: `ip http authentication enable` (enable secret/password) or `local` (username …).
 */
import type { IosDevice } from '../ios/device.ts';
import { Session } from '../ios/session.ts';
import type { ModeName } from '../ios/device.ts';
import { httpPrivilege, MAX_PRIVILEGE } from '../ios/http.ts';
import type { Peer } from '../net/tcp.ts';
import type { HttpRequest, HttpResponse } from './http.ts';
import { basicAuth, formFields, forMethod, pathOnly, query, respond, unauthorized } from './http.ts';
import { page, h } from './html.ts';
import type { Child } from './html.ts';
import { homePage, execPage, configurePage, frame } from './ios-web-pages.ts';
import type { Transcript } from './ios-web-pages.ts';
import { deviceManager, portSettings } from './ios-dm.ts';
import { formatIp } from '../core/ip.ts';

export const IOS_BANNER = 'cisco-IOS';
const MAX_COMMAND = 512;
const MAX_CONFIG_LINES = 200;

interface Who {
  readonly user: string;
  readonly level: number;
  readonly peer: Peer;
}

function decodeWord(w: string): string {
  try {
    return decodeURIComponent(w);
  } catch {
    return w;
  }
}

/** Runs EXEC commands at a level (15 → privileged EXEC, lower → user EXEC). */
export function runExec(device: IosDevice, level: number, command: string): Transcript {
  const s = new Session(device);
  s.mode = (level >= MAX_PRIVILEGE ? 'exec' : 'user') as ModeName;
  const prompt = s.prompt();
  return [{ prompt, command, output: s.input(command.slice(0, MAX_COMMAND)) }];
}

/** Runs configuration lines as from `configure terminal`, one by one, and logs who did it. */
export function runConfig(device: IosDevice, lines: readonly string[], who: Who): Transcript {
  const s = new Session(device);
  s.mode = 'config';
  const out: { prompt: string; command: string; output: string[] }[] = [];
  for (const raw of lines.slice(0, MAX_CONFIG_LINES)) {
    const line = raw.replace(/[\r\n\t]/g, ' ').slice(0, MAX_COMMAND);
    if (!line.trim()) continue;
    const mode = s.mode as ModeName;
    if (mode === 'exec' || mode === 'user') break;
    out.push({ prompt: s.prompt(), command: line, output: s.input(line) });
  }
  if (out.length) device.log(`%SYS-5-CONFIG_I: Configured from console by ${who.user} on vty0 (${formatIp(who.peer.ip)})`);
  return out;
}

function denied(level: number): HttpResponse {
  return unauthorized(IOS_BANNER, `level_${level}_access`, page('Authorization Required', '', h('h1', {}, '401 Unauthorized'), h('p', {}, 'Authorization Required')));
}

/** "/level/15/exec/-/show/ip/route/CR" → { level: 15, area: 'exec', words: ['show','ip','route'], cr: true } */
export function parseLevelPath(path: string): { level: number; area: string; words: string[]; cr: boolean } | null {
  const m = /^\/level\/(\d{1,2})\/([a-z]+)(?:\/-)?((?:\/[^/]*)*)\/?$/.exec(pathOnly(path));
  if (!m) return null;
  const level = Number(m[1]);
  if (level > MAX_PRIVILEGE) return null;
  const words = (m[3] ?? '').split('/').filter(Boolean).map(decodeWord);
  const cr = words.at(-1)?.toUpperCase() === 'CR';
  return { level, area: m[2] ?? '', words: cr ? words.slice(0, -1) : words, cr };
}

function levelPage(device: IosDevice, req: HttpRequest, who: Who, route: NonNullable<ReturnType<typeof parseLevelPath>>): HttpResponse {
  const ok = (title: string, body: Child): HttpResponse => respond(IOS_BANNER, 200, frame(device, title, [body]));
  if (route.area === 'exec') {
    const typed = query(req).get('command')?.trim();
    const command = typed || (route.cr ? route.words.join(' ') : '');
    const base = `/level/${route.level}/exec/-`;
    if (command) return ok(`${device.hostname} Home Page`, execPage(device, route.level, base, req.path, command, runExec(device, route.level, command)));
    return ok(`${device.hostname} Home Page`, execPage(device, route.level, base, req.path, route.words.join(' '), null));
  }
  if (route.level < MAX_PRIVILEGE) return respond(IOS_BANNER, 404, 'Not Found');
  if (route.area === 'configure') {
    const text = req.method === 'POST' ? formFields(req).get('command') ?? '' : '';
    return ok(`${device.hostname} Configure`, configurePage(text ? runConfig(device, text.split('\n'), who) : null));
  }
  if (route.area === 'dm') {
    const notice = req.method === 'POST' ? portSettings(device, formFields(req), (lines) => runConfig(device, lines, who)) : null;
    return ok(`Device Manager - ${device.hostname}`, deviceManager(device, notice));
  }
  return respond(IOS_BANNER, 404, 'Not Found');
}

export function iosWeb(device: IosDevice, req: HttpRequest, peer: Peer): HttpResponse {
  const route = pathOnly(req.path) === '/' ? null : parseLevelPath(req.path);
  if (!route && pathOnly(req.path) !== '/') return respond(IOS_BANNER, 404, page('404 Not Found', '', h('h1', {}, 'Not Found')));
  const need = route?.level ?? MAX_PRIVILEGE;
  const cred = basicAuth(req);
  const level = cred ? httpPrivilege(device, cred.user, cred.password) : null;
  if (!cred || level === null || level < need) {
    if (cred) device.log(`%SEC_LOGIN-4-LOGIN_FAILED: Login failed [user: ${cred.user}] [Source: ${formatIp(peer.ip)}] [localport: ${device.http.port}] [Reason: Login Authentication Failed]`);
    return denied(need);
  }
  const who = { user: cred.user, level, peer };
  if (!route) return forMethod(req, respond(IOS_BANNER, 200, frame(device, `${device.hostname} Home Page`, [homePage(device, level)])));
  return forMethod(req, levelPage(device, req, who, route));
}
