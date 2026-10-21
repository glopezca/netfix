/** curl for the Ubuntu terminal: methods, data, headers, cookies, Basic auth, redirects (-L) and verbose output. */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { httpRequest } from './net-tools.ts';
import type { HttpOutcome } from './net-tools.ts';
import type { HttpHeaders, HttpMethod } from '../net/packets.ts';
import { basicHeader } from '../web/http.ts';
import { resolveLink } from '../web/url.ts';
import { FsError } from '../bash/vfs.ts';
import { formatIp } from '../core/ip.ts';

const MAX_REDIRECTS = 50;
const USER_AGENT = 'curl/8.14.1';

interface CurlOpts {
  url?: string;
  method?: HttpMethod;
  head: boolean;
  include: boolean;
  follow: boolean;
  verbose: boolean;
  fail: boolean;
  silent: boolean;
  showError: boolean;
  data: string[];
  headers: Record<string, string>;
  output?: string;
  remoteName: boolean;
  /** -w: printed after the transfer, with %{http_code}, %{size_download}, %{content_type}, %{url_effective}. */
  writeOut?: string;
  error?: string;
}

const WITH_ARG = new Set(['-X', '--request', '-d', '--data', '--data-raw', '-u', '--user', '-b', '--cookie', '-H', '--header', '-o', '--output', '-A', '--user-agent', '-e', '--referer', '-w', '--write-out', '-m', '--max-time', '--connect-timeout']);

/** Letters of a combined short option (-sSL, -sI…). */
function flag(c: string): Partial<CurlOpts> {
  const map: Readonly<Record<string, Partial<CurlOpts>>> = { s: { silent: true }, S: { showError: true }, L: { follow: true }, I: { head: true }, i: { include: true }, k: {},
    f: { fail: true }, v: { verbose: true }, O: { remoteName: true } };
  return map[c] ?? {};
}

function parse(args: readonly string[]): CurlOpts {
  const o: CurlOpts = { head: false, include: false, follow: false, verbose: false, fail: false, silent: false, showError: false, data: [], headers: {}, remoteName: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const v = WITH_ARG.has(a) ? args[++i] : undefined;
    if (WITH_ARG.has(a) && v === undefined) return { ...o, error: `option ${a}: requires parameter` };
    switch (a) {
      case '-I': case '--head': o.head = true; break;
      case '-i': case '--include': o.include = true; break;
      case '-L': case '--location': o.follow = true; break;
      case '-v': case '--verbose': o.verbose = true; break;
      case '-f': case '--fail': o.fail = true; break;
      case '-O': case '--remote-name': o.remoteName = true; break;
      case '-X': case '--request': o.method = (v ?? 'GET').toUpperCase() as HttpMethod; break;
      case '-d': case '--data': case '--data-raw': o.data.push(v ?? ''); break;
      case '-u': case '--user': { const [u, p = ''] = (v ?? '').split(/:(.*)/s, 2) as [string, string | undefined]; o.headers.authorization = basicHeader(u, p); break; }
      case '-b': case '--cookie': o.headers.cookie = v ?? ''; break;
      case '-A': case '--user-agent': o.headers['user-agent'] = v ?? ''; break;
      case '-H': case '--header': { const m = /^([^:]+):\s*(.*)$/.exec(v ?? ''); if (m) o.headers[(m[1] ?? '').toLowerCase()] = m[2] ?? ''; break; }
      case '-o': case '--output': o.output = v; break;
      case '-w': case '--write-out': o.writeOut = v; break;
      default:
        if (/^-[sSkLIifvO]+$/.test(a) && a.length > 2) { for (const c of a.slice(1)) Object.assign(o, flag(c)); break; }
        if (a === '-s' || a === '--silent') { o.silent = true; break; }
        if (a === '-S' || a === '--show-error') { o.showError = true; break; }
        if (a.startsWith('-') && !WITH_ARG.has(a) && a !== '-k' && a !== '--insecure') return { ...o, error: `option ${a}: is unknown` };
        if (!a.startsWith('-')) o.url = a;
    }
  }
  return o;
}

type Response = Extract<HttpOutcome, { kind: 'ok' }>['response'];

/** Content-Length as the server sent it (a HEAD answer gives the size of the page it did not send). */
const contentLength = (res: Response): number => Number(res.headers?.['content-length'] ?? new TextEncoder().encode(res.body).length);

function headerBlock(res: Response, date: string): string {
  const extra = Object.entries(res.headers ?? {}).filter(([k]) => k !== 'content-length')
    .flatMap(([k, v]) => v.split('\n').map((line) => `${k.replace(/(^|-)\w/g, (c) => c.toUpperCase())}: ${line}`));
  return [`HTTP/1.1 ${res.status} ${res.reason}`, `Date: ${date}`, `Server: ${res.server}`, ...extra, `Content-Length: ${contentLength(res)}`, `Content-Type: ${res.contentType}`, '', ''].join('\n');
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\' };

/** The -w format with the transfer's values in one pass (a failed transfer has no response: code 000). Unknown variables print nothing. */
function writeOutText(format: string, res: Response | undefined, url: string): string {
  const vars: Record<string, string> = {
    http_code: String(res?.status ?? 0).padStart(3, '0'), response_code: String(res?.status ?? 0),
    size_download: String(res ? new TextEncoder().encode(res.body).length : 0), content_type: res?.contentType ?? '', url_effective: url,
  };
  return format.replace(/%\{(\w+)\}|%%|\\([nrt\\])/g, (m, k: string | undefined, e: string | undefined) =>
    (k !== undefined ? vars[k] ?? '' : e !== undefined ? ESCAPES[e] ?? m : '%'));
}

function verboseRequest(ctx: Ctx, url: string, method: string, headers: HttpHeaders, ip: number, port: number): void {
  const m = /^(?:https?:\/\/)?([^/:]+)/.exec(url);
  const lines = [`*   Trying ${formatIp(ip)}:${port}...`, `* Connected to ${m?.[1] ?? url} (${formatIp(ip)}) port ${port}`, `> ${method} ${url.replace(/^(?:https?:\/\/)?[^/]+/, '') || '/'} HTTP/1.1`,
    ...Object.entries(headers).map(([k, v]) => `> ${k.replace(/(^|-)\w/g, (c) => c.toUpperCase())}: ${v}`), '>'];
  ctx.err(`${lines.join('\n')}\n`);
}

function writeOut(ctx: Ctx, file: string, body: string): boolean {
  try {
    ctx.sh.env.fs.writeFile(ctx.resolve(file), body, ctx.cred);
    return true;
  } catch (e) {
    ctx.err(`curl: (23) Failure writing output to destination: ${file}: ${e instanceof FsError ? e.message : 'error'}\n`);
    return false;
  }
}

export function curl(host: Host): CommandFn {
  return (ctx: Ctx): number => {
    const o = parse(ctx.argv.slice(1));
    if (o.error) { ctx.err(`curl: ${o.error}\ncurl: try 'curl --help' or 'curl --manual' for more information\n`); return 2; }
    if (!o.url) { ctx.err("curl: try 'curl --help' or 'curl --manual' for more information\n"); return 2; }
    const date = new Date(host.clock.now()).toUTCString();
    let url = o.url;
    let method: HttpMethod = o.method ?? (o.head ? 'HEAD' : o.data.length ? 'POST' : 'GET');
    let body = o.data.length ? o.data.join('&') : undefined;
    let out = '';
    let written = '';
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: '*/*', ...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...o.headers };
      const r = httpRequest(host, url, { method, headers, body });
      if (r.kind === 'error') {
        if (!o.silent || o.showError) ctx.err(`curl: (${r.code}) ${r.message}\n`);
        if (o.writeOut !== undefined) ctx.out(writeOutText(o.writeOut, undefined, url));
        return r.code;
      }
      const res = r.response;
      if (o.verbose) verboseRequest(ctx, url, method, headers, r.ip, Number(/:(\d+)/.exec(url.replace(/^\w+:\/\//, ''))?.[1] ?? 80));
      if (o.verbose) ctx.err(`${headerBlock(res, date).trimEnd().split('\n').map((l) => `< ${l}`).join('\n')}\n<\n`);
      if (o.head || o.include) out += headerBlock(res, date);
      const location = res.headers?.location;
      if (o.follow && location && [301, 302, 303, 307, 308].includes(res.status) && hop < MAX_REDIRECTS) {
        url = resolveLink(url, location);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
        continue;
      }
      if (o.fail && res.status >= 400) {
        if (!o.silent || o.showError) ctx.err(`curl: (22) The requested URL returned error: ${res.status}\n`);
        if (o.writeOut !== undefined) ctx.out(writeOutText(o.writeOut, res, url));
        return 22;
      }
      if (!o.head) out += res.body;
      written = o.writeOut === undefined ? '' : writeOutText(o.writeOut, res, url);
      break;
    }
    const target = o.output ?? (o.remoteName ? url.split('/').filter(Boolean).slice(2).pop() ?? 'index.html' : undefined);
    let saved = true;
    if (target === undefined) ctx.out(out);
    else if (target !== '/dev/null') saved = writeOut(ctx, target, out);
    if (written) ctx.out(written);
    return saved ? 0 : 23;
  };
}
