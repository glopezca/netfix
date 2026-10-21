/** The Server management GUI: HTTP Basic login, pages and form actions (POST, then redirect). */
import { t } from '../i18n/t.ts';
import { withLocale } from '../i18n/locale.ts';
import { requestLocale } from './html.ts';
import type { Server } from '../devices/server.ts';
import type { Peer } from '../net/tcp.ts';
import type { HttpRequest, HttpResponse } from './http.ts';
import { basicAuth, formFields, query, redirect, respond, unauthorized, forMethod } from './http.ts';
import { h, page } from './html.ts';
import { PAGES, frame, pagesOf } from './admin-layout.ts';
import { setupPage, dhcpPage, webPage, mailPage, sshPage, adminPage, statusPage, logPage } from './admin-pages.ts';
import type { Child } from './html.ts';
import { runAction } from './admin-actions.ts';
import { dnsPage } from './admin-dns.ts';
import { firewallPage, routingPage } from './admin-firewall.ts';
import { vpnPage } from './admin-vpn.ts';
import { formatIp } from '../core/ip.ts';

/** User names come from the request: no control characters in the logs. */
const printable = (text: string): string => text.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 64);

const BANNER = 'netfix-webui/0.4';
const REALM = 'Server';

function body(server: Server, base: string, id: string, q: ReadonlyMap<string, string>): Child {
  switch (id) {
    case 'dhcp': return dhcpPage(server, base);
    case 'dns': return dnsPage(server, base, q);
    case 'web': return webPage(server, base);
    case 'mail': return mailPage(server, base);
    case 'ssh': return sshPage(server, base);
    case 'firewall': return firewallPage(server, base);
    case 'routing': return routingPage(server, base);
    case 'vpn': return vpnPage(server, base);
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

/** Answers in the visitor's language (Accept-Language). */
export function serverAdmin(server: Server, req: HttpRequest, peer: Peer, base: string): HttpResponse {
  return withLocale(requestLocale(req), () => adminResponse(server, req, peer, base));
}

function adminResponse(server: Server, req: HttpRequest, peer: Peer, base: string): HttpResponse {
  const a = server.services.webapps.admin;
  const cred = basicAuth(req);
  if (!cred || cred.user !== a.user || cred.password !== a.password) {
    if (cred) server.log('http', t('wa.denied', { user: printable(cred.user), ip: formatIp(peer.ip) }));
    return unauthorized(BANNER, REALM, page('401 Unauthorized', '', h('h1', {}, 'Unauthorized'), h('p', {}, t('wa.needLogin'))));
  }
  const q = query(req);
  const current = pagesOf(server).find((p) => p.id === q.get('page')) ?? PAGES[0];
  if (!current) return respond(BANNER, 404, 'Not Found');
  if (req.method === 'POST') {
    const fields = formFields(req);
    const result = runAction(server, current.id, fields);
    server.log('http', t('wa.logAction', { user: printable(cred.user), ip: formatIp(peer.ip), page: current.id, result: result.error ?? t('wa.logSaved') }));
    // The page is drawn again with what was sent, so a failed step keeps its tab and what was typed.
    if (result.error) return respond(BANNER, 200, frame(server, base, current, { error: result.error }, body(server, base, current.id, new Map([...q, ...fields]))));
    return redirect(BANNER, result.moved ? newHome(server, req) : `${base}/?page=${current.id}${result.next ?? ''}&saved=1`, {}, 303);
  }
  const notice = q.get('saved') ? { ok: t('wa.saved') } : {};
  return forMethod(req, respond(BANNER, 200, frame(server, base, current, notice, body(server, base, current.id, q))));
}
