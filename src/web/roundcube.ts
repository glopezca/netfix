/**
 * Roundcube Webmail 1.6 (Elastic look) on a Server: login against the mail accounts (IMAP),
 * Inbox/Sent/Trash, reading, composing and sending through the server's own SMTP (MX relay included).
 */
import type { Server } from '../devices/server.ts';
import type { Peer } from '../net/tcp.ts';
import type { MailMessage } from '../net/packets.ts';
import type { HttpRequest, HttpResponse } from './http.ts';
import { cookies, formFields, query, redirect, respond, forMethod } from './http.ts';
import { h, page } from './html.ts';
import type { Child, Markup } from './html.ts';
import { Sessions } from './sessions.ts';
import { formatIp } from '../core/ip.ts';

const COOKIE = 'roundcube_sessid';
const FOLDERS = [['INBOX', 'Bandeja de entrada'], ['Sent', 'Enviados'], ['Trash', 'Papelera']] as const;
type Folder = (typeof FOLDERS)[number][0];
const MAX_BODY = 100_000;

interface RcSession {
  readonly user: string;
  readonly address: string;
}

const sessions = new WeakMap<Server, Sessions<RcSession>>();

function store(server: Server): Sessions<RcSession> {
  const s = sessions.get(server) ?? new Sessions<RcSession>();
  sessions.set(server, s);
  return s;
}

/** Mailbox key of a folder: INBOX is the user's mailbox (shared with POP3/IMAP clients). */
function boxKey(user: string, folder: Folder): string {
  return folder === 'INBOX' ? user : `${user}:${folder}`;
}

function folderOf(text: string | undefined): Folder {
  return FOLDERS.find(([f]) => f === text)?.[0] ?? 'INBOX';
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

const banner = (server: Server): string => (server.os === 'windows' ? 'Microsoft-IIS/10.0' : 'Apache/2.4.62 (Ubuntu)');

function shell(server: Server, base: string, title: string, s: RcSession, folder: Folder, main: Child): string {
  const link = (q: string): string => `${base}/?${q}`;
  const nav = FOLDERS.map(([f, label]) => {
    const n = server.mailboxes.list(boxKey(s.user, f)).length;
    return h('li', { class: f === folder ? 'web-rc-current' : undefined }, h('a', { href: link(`_task=mail&_mbox=${f}`) }, label, n ? h('span', { class: 'web-rc-count' }, String(n)) : null));
  });
  return page(`Roundcube Webmail :: ${title}`, 'web-rc',
    h('div', { class: 'web-rc-layout' },
      h('nav', { class: 'web-rc-menu' }, h('div', { class: 'web-rc-logo' }, 'roundcube'),
        h('a', { href: link('_task=mail&_action=compose'), class: 'web-rc-compose' }, '✎ Redactar'), h('ul', { class: 'web-rc-folders' }, nav),
        h('a', { href: link('_task=logout'), class: 'web-rc-logout' }, `Cerrar sesión (${s.address})`)),
      h('main', { class: 'web-rc-main' }, main)),
    h('p', { class: 'web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), 'Roundcube Webmail · Netfix'));
}

function loginPage(base: string, error?: string): string {
  return page('Roundcube Webmail :: Bienvenido a Roundcube Webmail', 'web-rc web-rc-login',
    h('div', { class: 'web-rc-loginbox' },
      h('div', { class: 'web-rc-logo' }, 'roundcube'),
      error ? h('p', { class: 'web-rc-error' }, error) : null,
      h('form', { method: 'post', action: `${base}/?_task=login` },
        h('input', { type: 'hidden', name: '_action', value: 'login' }),
        h('label', {}, 'Usuario', h('input', { type: 'text', name: '_user', autocomplete: 'off' })),
        h('label', {}, 'Contraseña', h('input', { type: 'password', name: '_pass' })),
        h('button', { type: 'submit', class: 'web-rc-button' }, 'Iniciar sesión')),
      h('p', { class: 'web-rc-footer web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), 'Roundcube Webmail · Netfix')));
}

function messageList(base: string, mails: readonly MailMessage[], folder: Folder, selected: number): Markup {
  if (!mails.length) return h('p', { class: 'web-rc-empty' }, 'La lista está vacía.');
  const rows = mails.map((m, i) => ({ m, i })).reverse().map(({ m, i }) =>
    h('tr', { class: i === selected ? 'web-rc-selected' : undefined },
      h('td', {}, folder === 'Sent' ? m.to.join(', ') : m.from),
      h('td', {}, h('a', { href: `${base}/?_task=mail&_mbox=${folder}&_action=show&_uid=${i}` }, m.subject || '(sin asunto)')),
      h('td', {}, stamp(m.date))));
  return h('table', { class: 'web-rc-list' }, h('tr', {}, h('th', {}, folder === 'Sent' ? 'Para' : 'De'), h('th', {}, 'Asunto'), h('th', {}, 'Fecha')), rows);
}

function messageView(base: string, m: MailMessage, folder: Folder, uid: number): Markup {
  const reply = `${base}/?_task=mail&_action=compose&_reply_uid=${uid}&_mbox=${folder}`;
  return h('article', { class: 'web-rc-message' },
    h('div', { class: 'web-rc-toolbar' }, h('a', { href: reply }, '↩ Responder'), h('a', { href: `${base}/?_task=mail&_action=delete&_uid=${uid}&_mbox=${folder}` }, '🗑 Eliminar')),
    h('h2', {}, m.subject || '(sin asunto)'),
    h('p', { class: 'web-rc-meta' }, `De: ${m.from} · Para: ${m.to.join(', ')} · ${stamp(m.date)}`),
    h('pre', { class: 'web-rc-body' }, m.body));
}

function composeForm(base: string, s: RcSession, to = '', subject = '', body = '', error?: string): Markup {
  return h('form', { method: 'post', action: `${base}/?_task=mail&_action=send`, class: 'web-rc-composeform' },
    h('h2', {}, 'Redactar'),
    error ? h('p', { class: 'web-rc-error' }, error) : null,
    h('label', {}, 'De', h('input', { type: 'text', name: '_from', value: s.address, readonly: true })),
    h('label', {}, 'Para', h('input', { type: 'text', name: '_to', value: to })),
    h('label', {}, 'Asunto', h('input', { type: 'text', name: '_subject', value: subject })),
    h('label', {}, 'Mensaje', h('textarea', { name: '_message', rows: 10 }, body)),
    h('button', { type: 'submit', class: 'web-rc-button' }, 'Enviar'));
}

function mailbox(server: Server, base: string, s: RcSession, req: HttpRequest): HttpResponse {
  const q = query(req);
  const folder = folderOf(q.get('_mbox'));
  const key = boxKey(s.user, folder);
  const action = q.get('_action') ?? '';
  const uid = Number(q.get('_uid') ?? -1);
  const html = (title: string, main: Child): HttpResponse => respond(banner(server), 200, shell(server, base, title, s, folder, main));
  if (action === 'compose') {
    const orig = server.mailboxes.list(boxKey(s.user, folderOf(q.get('_mbox'))))[Number(q.get('_reply_uid') ?? -1)];
    const quoted = orig ? `\n\nEl ${stamp(orig.date)}, ${orig.from} escribió:\n${orig.body.split('\n').map((l) => `> ${l}`).join('\n')}` : '';
    return html('Redactar', composeForm(base, s, orig?.from ?? '', orig ? `Re: ${orig.subject}` : '', quoted));
  }
  if (action === 'delete' && uid >= 0) {
    const gone = server.mailboxes.removeAt(key, uid);
    if (gone && folder !== 'Trash') server.mailboxes.deliver(boxKey(s.user, 'Trash'), gone);
    return redirect(banner(server), `${base}/?_task=mail&_mbox=${folder}`);
  }
  const mails = server.mailboxes.list(key);
  const open = action === 'show' ? mails[uid] : undefined;
  const label = FOLDERS.find(([f]) => f === folder)?.[1] ?? folder;
  return html(label, [h('h1', {}, label), messageList(base, mails, folder, open ? uid : -1), open ? messageView(base, open, folder, uid) : null]);
}

function send(server: Server, base: string, s: RcSession, req: HttpRequest): HttpResponse {
  const f = formFields(req);
  const to = (f.get('_to') ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const subject = (f.get('_subject') ?? '').slice(0, 998);
  const body = (f.get('_message') ?? '').slice(0, MAX_BODY);
  const again = (error: string): HttpResponse => respond(banner(server), 200, shell(server, base, 'Redactar', s, 'INBOX', composeForm(base, s, to.join(', '), subject, body, error)));
  if (!to.length) return again('Indica al menos un destinatario.');
  if (!server.services.mail.smtp) return again('Error SMTP: no se pudo conectar con el servidor SMTP (localhost:25).');
  const mail: MailMessage = { from: s.address, to, subject, body, date: server.clock.now() };
  const r = server.submitMail(mail);
  if (!r.ok) return again(`Error SMTP (${r.text})`);
  server.mailboxes.deliver(boxKey(s.user, 'Sent'), mail);
  return redirect(banner(server), `${base}/?_task=mail&_mbox=Sent`);
}

function login(server: Server, base: string, req: HttpRequest, peer: Peer): HttpResponse {
  const f = formFields(req);
  const user = (f.get('_user') ?? '').trim().toLowerCase().replace(/@.*$/, '');
  const fail = (msg: string): HttpResponse => respond(banner(server), 200, loginPage(base, msg));
  if (!server.services.mail.imap) return fail('Error de conexión con el servidor de almacenamiento (IMAP).');
  if (!server.mailLogin(user, f.get('_pass') ?? '')) {
    server.log('mailbox', `dovecot: imap-login: Disconnected (auth failed, 1 attempts): user=<${user}>, rip=${formatIp(peer.ip)} (roundcube)`);
    return fail('Error de inicio de sesión.');
  }
  server.log('mailbox', `dovecot: imap-login: Login: user=<${user}>, rip=127.0.0.1 (roundcube, cliente ${formatIp(peer.ip)})`);
  const id = store(server).create({ user, address: `${user}@${server.services.mail.domain || 'localhost'}` }, server.clock.now());
  return redirect(banner(server), `${base}/?_task=mail&_mbox=INBOX`, { 'set-cookie': `${COOKIE}=${id}; path=${base || '/'}; HttpOnly` });
}

export function roundcube(server: Server, req: HttpRequest, peer: Peer, base: string): HttpResponse {
  const q = query(req);
  const task = q.get('_task') ?? '';
  const sid = cookies(req).get(COOKIE);
  const s = store(server).get(sid, server.clock.now());
  if (task === 'login' && req.method === 'POST') return login(server, base, req, peer);
  if (task === 'logout') {
    store(server).drop(sid);
    return redirect(banner(server), `${base}/?_task=login`, { 'set-cookie': `${COOKIE}=; path=${base || '/'}; Max-Age=0` });
  }
  if (!s) return forMethod(req, respond(banner(server), 200, loginPage(base)));
  if (q.get('_action') === 'send' && req.method === 'POST') return send(server, base, s, req);
  return forMethod(req, mailbox(server, base, s, req));
}
