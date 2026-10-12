/** The PC web browser's engine: navigation, forms, cookies, redirects and HTTP Basic authentication. */
import type { Host } from '../devices/host.ts';
import { httpRequest } from '../shells/net-tools.ts';
import type { HttpOutcome } from '../shells/net-tools.ts';
import type { HttpMethod } from '../net/packets.ts';
import { basicHeader, encodeForm } from '../web/http.ts';
import type { HttpResponse } from '../web/http.ts';
import { resolveLink } from '../web/url.ts';

const MAX_REDIRECTS = 10;
const MAX_COOKIES = 50;

export type BrowseResult =
  | { readonly kind: 'page'; readonly url: string; readonly response: HttpResponse; readonly ip: number }
  | { readonly kind: 'auth'; readonly url: string; readonly realm: string; readonly failed: boolean }
  | { readonly kind: 'error'; readonly url: string; readonly code: number; readonly message: string };

export interface Navigation {
  readonly method?: HttpMethod;
  /** Form fields: sent as the query string (GET) or the body (POST). */
  readonly form?: readonly (readonly [string, string])[];
  /** URL of the page that started the navigation (a link or a form); absent when the user typed it. */
  readonly initiator?: string;
}

interface Cookie {
  readonly value: string;
  readonly path: string;
}

/** "http://Host:8080/a/b?x" → "host:8080" */
export function originOf(url: string): string {
  const m = /^(?:https?:\/\/)?([^/?#]+)/i.exec(url);
  const host = (m?.[1] ?? '').toLowerCase();
  return host.includes(':') ? host : `${host}:80`;
}

function pathOf(url: string): string {
  return /^(?:https?:\/\/)?[^/?#]+(\/[^?#]*)?/i.exec(url)?.[1] ?? '/';
}

export class BrowserEngine {
  private readonly host: Host;
  private readonly jar = new Map<string, Map<string, Cookie>>();
  private readonly credentials = new Map<string, string>();

  constructor(host: Host) {
    this.host = host;
  }

  /** Opens a URL (following redirects), sending cookies and saved credentials. */
  open(target: string, nav: Navigation = {}): BrowseResult {
    let url = /^https?:\/\//i.test(target) ? target : `http://${target}`;
    let method: HttpMethod = nav.method ?? 'GET';
    let body: string | undefined;
    if (nav.form) {
      const encoded = encodeForm(nav.form);
      if (method === 'POST') body = encoded;
      else url = `${url.split('?')[0] ?? url}?${encoded}`;
    }
    // Saved passwords and cookies go with what the user does (typed URL, link, GET form, same-site POST),
    // not with a cross-site POST or a redirect to another site: a page cannot drive a router behind the user's back.
    let credentials = !nav.initiator || method === 'GET' || originOf(nav.initiator) === originOf(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = this.fetch(url, method, body, credentials);
      if (r.kind === 'error') return { kind: 'error', url, code: r.code, message: r.message };
      const res = r.response;
      this.storeCookies(url, res);
      const location = res.headers?.location;
      if (location && [301, 302, 303, 307, 308].includes(res.status)) {
        const next = resolveLink(url, location);
        if (originOf(next) !== originOf(url)) credentials = false;
        url = next;
        if (res.status !== 307 && res.status !== 308) { method = 'GET'; body = undefined; }
        continue;
      }
      if (res.status === 401 && /^Basic/i.test(res.headers?.['www-authenticate'] ?? '')) {
        const realm = /realm="([^"]*)"/i.exec(res.headers?.['www-authenticate'] ?? '')?.[1] ?? '';
        return { kind: 'auth', url, realm, failed: this.credentials.has(originOf(url)) };
      }
      return { kind: 'page', url, response: res, ip: r.ip };
    }
    return { kind: 'error', url, code: 47, message: 'Demasiadas redirecciones (ERR_TOO_MANY_REDIRECTS)' };
  }

  /** Remembers user and password for the site and opens the URL again. */
  login(url: string, user: string, password: string): BrowseResult {
    this.credentials.set(originOf(url), basicHeader(user, password));
    return this.open(url);
  }

  /** Cookies stored for a URL, as the Cookie header sends them. */
  cookieHeader(url: string): string {
    const path = pathOf(url);
    const list = [...(this.jar.get(originOf(url)) ?? new Map<string, Cookie>()).entries()];
    return list.filter(([, c]) => path.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; ');
  }

  private fetch(url: string, method: HttpMethod, body: string | undefined, credentials: boolean): HttpOutcome {
    const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0 (Netfix)' };
    const cookie = credentials ? this.cookieHeader(url) : '';
    if (cookie) headers.cookie = cookie;
    const auth = credentials ? this.credentials.get(originOf(url)) : undefined;
    if (auth) headers.authorization = auth;
    if (body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
    return httpRequest(this.host, url, { method, headers, body });
  }

  private storeCookies(url: string, res: HttpResponse): void {
    const raw = res.headers?.['set-cookie'];
    if (!raw) return;
    const origin = originOf(url);
    const jar = this.jar.get(origin) ?? new Map<string, Cookie>();
    for (const line of raw.split('\n')) {
      const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
      const [name, value = ''] = pair.split(/=(.*)/s, 2) as [string, string | undefined];
      if (!name) continue;
      const path = attrs.find((a) => /^path=/i.test(a))?.slice(5) || '/';
      const expired = attrs.some((a) => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a));
      if (expired) jar.delete(name);
      else if (jar.size < MAX_COOKIES || jar.has(name)) jar.set(name, { value, path });
    }
    this.jar.set(origin, jar);
  }
}
