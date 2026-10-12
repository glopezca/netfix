/** The Server-PT management GUI: HTTP Basic login, pages and form actions (POST, then redirect). */
import type { Server } from '../devices/server.ts';
import type { Peer } from '../net/tcp.ts';
import type { HttpRequest, HttpResponse } from './http.ts';
import { basicAuth, formFields, query, redirect, respond, unauthorized, forMethod } from './http.ts';
import { h, page } from './html.ts';
import { PAGES, frame } from './admin-layout.ts';
import { setupPage, dhcpPage, dnsPage, webPage, mailPage, sshPage, adminPage, statusPage, logPage } from './admin-pages.ts';
import type { Child } from './html.ts';
import { runAction } from './admin-actions.ts';
import { formatIp } from '../core/ip.ts';

/** User names come from the request: no control characters in the logs. */
const printable = (text: string): string => text.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 64);

const BANNER = 'netsim-webui/0.4';
const REALM = 'Server-PT';

function body(server: Server, base: string, id: string): Child {
  switch (id) {
    case 'dhcp': return dhcpPage(server, base);
    case 'dns': return dnsPage(server, base);
    case 'web': return webPage(server, base);
    case 'mail': return mailPage(server, base);
    case 'ssh': return sshPage(server, base);
    case 'admin': return adminPage(server, base);
    case 'status': return statusPage(server);
    case 'log': return logPage(server);
    default: return setupPage(server, base);
  }
}

/** Where the GUI lives after its access settings change. */
function newHome(server: Server, req: HttpRequest): string {
  const a = server.services.webapps.admin;
  const host = (req.headers?.host ?? req.host).replace(/:\d+$/, '');
  return a.mode === 'port' ? `http://${host}:${a.port}/?page=admin&saved=1` : `http://${host}${a.alias}/?page=admin&saved=1`;
}

export function serverAdmin(server: Server, req: HttpRequest, peer: Peer, base: string): HttpResponse {
  const a = server.services.webapps.admin;
  const cred = basicAuth(req);
  if (!cred || cred.user !== a.user || cred.password !== a.password) {
    if (cred) server.log('http', `netsim-webui: acceso denegado para «${printable(cred.user)}» desde ${formatIp(peer.ip)}`);
    return unauthorized(BANNER, REALM, page('401 Unauthorized', '', h('h1', {}, 'Unauthorized'), h('p', {}, 'Se necesita usuario y contraseña.')));
  }
  const q = query(req);
  const current = PAGES.find((p) => p.id === q.get('page')) ?? PAGES[0];
  if (!current) return respond(BANNER, 404, 'Not Found');
  if (req.method === 'POST') {
    const result = runAction(server, current.id, formFields(req));
    server.log('http', `netsim-webui: ${printable(cred.user)} desde ${formatIp(peer.ip)} → ${current.id}: ${result.error ?? 'guardado'}`);
    if (result.error) return respond(BANNER, 200, frame(server, base, current, { error: result.error }, body(server, base, current.id)));
    return redirect(BANNER, result.moved ? newHome(server, req) : `${base}/?page=${current.id}&saved=1`, {}, 303);
  }
  const notice = q.get('saved') ? { ok: 'Los cambios se han guardado correctamente.' } : {};
  return forMethod(req, respond(BANNER, 200, frame(server, base, current, notice, body(server, base, current.id))));
}
