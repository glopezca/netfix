/** Answers a request from an Apache configuration: virtual host, Redirect, Alias, DocumentRoot, index, autoindex and errors. */
import type { HttpRequest, HttpResponse } from '../../web/http.ts';
import { pathOnly, respond, forMethod } from '../../web/http.ts';
import { h, page } from '../../web/html.ts';
import type { ApacheConfig, DirBlock, VHost } from './model.ts';

export type FsResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: 'ENOENT' | 'EACCES' | 'ENOTDIR' };

export interface WebEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly size: number;
  readonly mtime: number;
}

/** The server's file system as www-data sees it. */
export interface WebFs {
  kind(path: string): FsResult<'file' | 'dir'>;
  read(path: string): FsResult<string>;
  list(dir: string): FsResult<WebEntry[]>;
}

const DEFAULT_ROOT = '/var/www/html';
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=UTF-8', htm: 'text/html; charset=UTF-8', css: 'text/css', js: 'text/javascript', json: 'application/json',
  txt: 'text/plain; charset=UTF-8', xml: 'text/xml', svg: 'image/svg+xml', md: 'text/markdown', csv: 'text/csv',
};

function contentType(path: string): string {
  return TYPES[/\.(\w+)$/.exec(path)?.[1]?.toLowerCase() ?? ''] ?? 'text/plain; charset=UTF-8';
}

function hostOf(req: HttpRequest): string {
  return (req.headers?.host ?? req.host).toLowerCase().replace(/:\d+$/, '');
}

function nameMatches(pattern: string, host: string): boolean {
  if (!pattern.includes('*')) return pattern === host;
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*')}$`).test(host);
}

/** Name-based virtual hosting: the vhost whose ServerName/ServerAlias matches, else the first for the port. */
export function selectVhost(cfg: ApacheConfig, port: number, host: string): VHost {
  const forPort = cfg.vhosts.filter((v) => v.port === port || v.port === 0);
  return forPort.find((v) => (v.serverName && nameMatches(v.serverName, host)) || v.serverAliases.some((a) => nameMatches(a, host))) ?? forPort[0] ?? cfg.main;
}

/** Joins a URL path to a directory, refusing to climb above it. */
function under(root: string, rest: string): string | null {
  const parts: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.pop()) return null; continue; }
    parts.push(seg);
  }
  return `${root.replace(/\/+$/, '')}/${parts.join('/')}`.replace(/\/+$/, '') || '/';
}

function mapPath(v: VHost, main: VHost, url: string): string | null {
  const aliases = [...v.aliases, ...main.aliases].sort((a, b) => b.url.length - a.url.length);
  for (const a of aliases) {
    const base = a.url.replace(/\/+$/, '');
    if (url === base || url.startsWith(`${base}/`) || (a.url.endsWith('/') && url.startsWith(a.url))) return under(a.path, url.slice(base.length));
  }
  return under(v.documentRoot ?? main.documentRoot ?? DEFAULT_ROOT, url);
}

/** Merges the <Directory> sections that apply to a path (shorter paths first, vhost after global). */
function dirSettings(cfg: ApacheConfig, v: VHost, path: string): { indexes: boolean; access: 'granted' | 'denied'; index: readonly string[] } {
  const applies = (d: DirBlock): boolean => !d.regex && (path === d.path || path.startsWith(d.path === '/' ? '/' : `${d.path}/`));
  const blocks = [...cfg.directories.filter(applies), ...v.directories.filter(applies)].sort((a, b) => a.path.length - b.path.length);
  let indexes = false;
  let access: 'granted' | 'denied' = 'granted';
  let index = v.directoryIndex ?? cfg.directoryIndex;
  for (const b of blocks) {
    if (b.options.indexes !== undefined) indexes = b.options.indexes;
    if (b.access) access = b.access;
    if (b.directoryIndex) index = b.directoryIndex;
  }
  return { indexes: indexes && cfg.modules.has('autoindex'), access, index };
}

function signature(cfg: ApacheConfig, banner: string, host: string, port: number): string {
  return cfg.serverSignature ? `${banner} Server at ${host} Port ${port}` : '';
}

function errorPage(cfg: ApacheConfig, v: VHost, status: number, banner: string, host: string, port: number): HttpResponse {
  const custom = v.errorDocs[status] ?? cfg.main.errorDocs[status];
  if (custom && !custom.startsWith('/')) return respond(banner, status, `${custom.replace(/^"|"$/g, '')}\n`);
  const text: Readonly<Record<number, [string, string]>> = {
    403: ['Forbidden', "You don't have permission to access this resource."],
    404: ['Not Found', 'The requested URL was not found on this server.'],
  };
  const [title, msg] = text[status] ?? ['Error', 'Error'];
  const sig = signature(cfg, banner, host, port);
  return respond(banner, status, page(`${status} ${title}`, '', h('h1', {}, title), h('p', {}, msg), sig ? h('hr') : null, sig ? h('address', {}, sig) : null), {}, 'text/html; charset=iso-8859-1');
}

function autoindex(url: string, entries: readonly WebEntry[], sig: string): string {
  const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const rows = [...entries].filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)).map((e) =>
    h('tr', {}, h('td', {}, h('a', { href: `${encodeURIComponent(e.name)}${e.dir ? '/' : ''}` }, `${e.name}${e.dir ? '/' : ''}`)), h('td', {}, stamp(e.mtime)), h('td', {}, e.dir ? '-' : String(e.size))));
  const parent = url === '/' ? null : h('tr', {}, h('td', {}, h('a', { href: '../' }, 'Parent Directory')), h('td', {}, ''), h('td', {}, '-'));
  return page(`Index of ${url}`, '', h('h1', {}, `Index of ${url}`), h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Last modified'), h('th', {}, 'Size')), parent, rows), sig ? h('hr') : null, sig ? h('address', {}, sig) : null);
}

function redirectFor(v: VHost, main: VHost, url: string, banner: string): HttpResponse | null {
  for (const r of [...v.redirects, ...main.redirects]) {
    const base = r.url.replace(/\/+$/, '');
    if (url !== base && !url.startsWith(`${base}/`) && !(base === '' && url.startsWith('/'))) continue;
    const location = `${r.target.replace(/\/+$/, '')}${url.slice(base.length)}`;
    return respond(banner, r.status, page(`${r.status} Moved`, '', h('h1', {}, 'Moved'), h('p', {}, 'The document has moved ', h('a', { href: location }, 'here'), '.')), { location });
  }
  return null;
}

function decodePath(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function serveApache(cfg: ApacheConfig, fs: WebFs, req: HttpRequest, port: number, banner: string): HttpResponse {
  const host = hostOf(req);
  const v = selectVhost(cfg, port, host);
  const shownHost = v.serverName ?? host;
  const url = decodePath(pathOnly(req.path));
  const moved = redirectFor(v, cfg.main, url, banner);
  if (moved) return forMethod(req, moved);
  const path = mapPath(v, cfg.main, url);
  const fail = (status: number): HttpResponse => forMethod(req, errorPage(cfg, v, status, banner, shownHost, port));
  if (path === null) return fail(403);
  const kind = fs.kind(path);
  if (!kind.ok) return fail(kind.code === 'EACCES' ? 403 : 404);
  const dirOf = kind.value === 'dir' ? path : path.replace(/\/[^/]*$/, '') || '/';
  const settings = dirSettings(cfg, v, dirOf);
  if (settings.access === 'denied') return fail(403);
  if (kind.value === 'file') {
    const body = fs.read(path);
    return body.ok ? forMethod(req, respond(banner, 200, body.value, {}, contentType(path))) : fail(body.code === 'EACCES' ? 403 : 404);
  }
  if (!url.endsWith('/')) return forMethod(req, respond(banner, 301, '', { location: `http://${req.headers?.host ?? req.host}${url}/` }));
  for (const name of settings.index) {
    const file = fs.read(`${path === '/' ? '' : path}/${name}`);
    if (file.ok) return forMethod(req, respond(banner, 200, file.value, {}, contentType(name)));
  }
  if (!settings.indexes) return fail(403);
  const list = fs.list(path);
  return list.ok ? forMethod(req, respond(banner, 200, autoindex(url, list.value, signature(cfg, banner, shownHost, port)))) : fail(403);
}
