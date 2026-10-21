/** HTTP helpers for the simulated web applications: requests, forms, cookies, Basic auth and responses. */
import type { AppPayload, HttpHeaders } from '../net/packets.ts';

export type HttpRequest = Extract<AppPayload, { app: 'HTTP'; kind: 'request' }>;
export type HttpResponse = Extract<AppPayload, { app: 'HTTP'; kind: 'response' }>;

export const REASONS: Readonly<Record<number, string>> = {
  200: 'OK', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error', 503: 'Service Unavailable',
};

const MAX_FORM = 64 * 1024;

export function pathOnly(path: string): string {
  return (path.split(/[?#]/)[0] ?? '/') || '/';
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** application/x-www-form-urlencoded (also query strings). */
export function parseForm(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of text.slice(0, MAX_FORM).split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split(/=(.*)/s, 2) as [string, string | undefined];
    out.set(decode(k), decode(v));
  }
  return out;
}

export function encodeForm(fields: Iterable<readonly [string, string]>): string {
  return [...fields].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export function query(req: HttpRequest): Map<string, string> {
  const q = req.path.indexOf('?');
  return parseForm(q >= 0 ? req.path.slice(q + 1).split('#')[0] ?? '' : '');
}

/** Form fields of a POST (or the query string of a GET). */
export function formFields(req: HttpRequest): Map<string, string> {
  return req.method === 'POST' ? parseForm(req.body ?? '') : query(req);
}

export function cookies(req: HttpRequest): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers?.cookie ?? '').split(';')) {
    const [k, v] = part.trim().split(/=(.*)/s, 2) as [string, string | undefined];
    if (k) out.set(k, v ?? '');
  }
  return out;
}

export function basicAuth(req: HttpRequest): { user: string; password: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(req.headers?.authorization ?? '');
  if (!m) return null;
  let text: string;
  try { text = atob(m[1] ?? ''); } catch { return null; }
  const i = text.indexOf(':');
  return i < 0 ? null : { user: text.slice(0, i), password: text.slice(i + 1) };
}

export function basicHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export function respond(server: string, status: number, body: string, headers: HttpHeaders = {}, contentType = 'text/html; charset=UTF-8'): HttpResponse {
  return { app: 'HTTP', kind: 'response', status, reason: REASONS[status] ?? 'OK', server, contentType, body, headers };
}

export function redirect(server: string, location: string, extra: HttpHeaders = {}, status = 302): HttpResponse {
  return respond(server, status, `<!doctype html><title>${status} ${REASONS[status] ?? ''}</title><p>Moved to <a href="${location.replace(/"/g, '%22')}">here</a>.</p>`, { ...extra, location });
}

export function unauthorized(server: string, realm: string, body: string): HttpResponse {
  return respond(server, 401, body, { 'www-authenticate': `Basic realm="${realm.replace(/"/g, '')}"` });
}

/** Bytes of a body (UTF-8), as Content-Length counts them. */
export function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** Strips the body of a HEAD answer; its Content-Length still tells the size of the GET answer, as a real server's. */
export function forMethod(req: HttpRequest, res: HttpResponse): HttpResponse {
  return req.method === 'HEAD' ? { ...res, body: '', headers: { ...res.headers, 'content-length': String(byteLength(res.body)) } } : res;
}
