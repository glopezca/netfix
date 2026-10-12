/** PC desktop apps: web browser and e-mail client. */
import { el } from './dom.ts';
import { field, input, select, button, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { livePanel } from './server-dhcp-dns.ts';
import { renderHtml } from './html-render.ts';
import { resolveLink } from '../web/url.ts';
import type { Pc } from '../devices/pc.ts';
import { BrowserEngine } from '../clients/browser.ts';
import type { BrowseResult } from '../clients/browser.ts';
import { sendMail, receiveMail } from '../clients/mail-client.ts';
import type { MailAccount } from '../clients/mail-client.ts';
import { formatIp } from '../core/ip.ts';
import { formatLeaseTime } from '../core/clock.ts';

const engines = new WeakMap<Pc, BrowserEngine>();

function engineFor(pc: Pc): BrowserEngine {
  const e = engines.get(pc) ?? new BrowserEngine(pc);
  engines.set(pc, e);
  return e;
}

/** HTTP Basic login box, like the browser's own dialog. */
function authBox(url: string, realm: string, failed: boolean, onLogin: (user: string, password: string) => void): HTMLElement {
  const user = input({ autocomplete: 'off', 'aria-label': 'Usuario' });
  const pass = input({ type: 'password', 'aria-label': 'Contraseña' });
  const form = el('form', { class: 'browser-auth' },
    el('h2', {}, 'Iniciar sesión'),
    el('p', {}, `${url.replace(/^https?:\/\//, '').split('/')[0] ?? url} solicita usuario y contraseña. Sitio: «${realm}»`),
    failed ? el('p', { class: 'form-msg error' }, 'Usuario o contraseña incorrectos.') : null,
    field('Usuario', user), field('Contraseña', pass), el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn' }, 'Iniciar sesión')));
  form.addEventListener('submit', (e) => { e.preventDefault(); onLogin(user.value, pass.value); });
  return form;
}

export function browserApp(pc: Pc, app: AfterChange): HTMLElement {
  const engine = engineFor(pc);
  const history: string[] = [];
  const url = input({ value: pc.browserUrl || 'http://', 'aria-label': 'Dirección URL', class: 'url-bar' });
  const status = el('p', { class: 'browser-status', role: 'status' });
  const view = el('div', { class: 'browser-view', 'aria-live': 'polite' }, el('p', { class: 'muted' }, 'Escribe una URL (http://IP, http://nombre o http://nombre:puerto/ruta) y pulsa Ir.'));
  const show = (r: BrowseResult): void => {
    app.afterCommand();
    url.value = r.url;
    pc.browserUrl = r.url;
    if (history[history.length - 1] !== r.url) history.push(r.url);
    if (r.kind === 'error') {
      status.textContent = '';
      view.replaceChildren(el('h2', {}, 'No se puede acceder a este sitio'), el('p', {}, r.message), el('p', { class: 'muted' }, r.code === 6 ? 'Comprueba el servidor DNS del PC y el registro en el servidor.' : 'Comprueba que el servicio está activo en ese puerto y que hay ruta hasta el servidor.'));
      return;
    }
    if (r.kind === 'auth') {
      status.textContent = `401 Unauthorized · ${r.realm}`;
      view.replaceChildren(authBox(r.url, r.realm, r.failed, (u, p) => show(engine.login(r.url, u, p))));
      return;
    }
    const res = r.response;
    const page = renderHtml(res.contentType.startsWith('text/html') ? res.body : `<pre>${res.body.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)}</pre>`, {
      link: (href) => go(resolveLink(r.url, href)),
      submit: (action, method, fields) => show(engine.open(resolveLink(r.url, action || r.url), { method, form: fields, initiator: r.url })),
    });
    status.textContent = `${res.status} ${res.reason} · ${formatIp(r.ip)} · ${res.server}${page.title ? ` · ${page.title}` : ''}`;
    view.replaceChildren(page.body);
  };
  const go = (target: string): void => {
    status.textContent = 'Cargando…';
    show(engine.open(target.trim()));
  };
  const back = button('←', () => {
    history.pop();
    const prev = history.pop();
    if (prev) go(prev);
  }, 'btn btn-icon');
  back.setAttribute('aria-label', 'Atrás');
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(url.value); });
  return el('div', { class: 'pane browser' }, el('div', { class: 'browser-bar' }, back, url, button('Ir', () => go(url.value)), button('⟳', () => go(url.value), 'btn btn-icon')), status, view);
}

const BLANK: MailAccount = { name: '', address: '', incoming: '', outgoing: '', protocol: 'POP3', user: '', password: '' };

export function mailApp(pc: Pc, app: AfterChange): HTMLElement {
  let reading = -1;
  return livePanel((refresh) => {
    const acc = pc.mailAccount ?? BLANK;
    const f = {
      name: input({ value: acc.name }), address: input({ value: acc.address, placeholder: 'ana@aula.lab' }),
      incoming: input({ value: acc.incoming, placeholder: 'IP o nombre' }), outgoing: input({ value: acc.outgoing, placeholder: 'IP o nombre' }),
      protocol: select([['POP3', 'POP3 (descarga y borra)'], ['IMAP', 'IMAP (deja copia en el servidor)']], acc.protocol),
      user: input({ value: acc.user }), password: input({ value: acc.password, type: 'password' }),
    };
    const accMsg = message();
    const saveAccount = (): void => {
      const next: MailAccount = { name: f.name.value.trim(), address: f.address.value.trim(), incoming: f.incoming.value.trim(), outgoing: f.outgoing.value.trim(), protocol: f.protocol.value === 'IMAP' ? 'IMAP' : 'POP3', user: f.user.value.trim(), password: f.password.value };
      if (!/^[^@\s]+@[^@\s]+$/.test(next.address)) return accMsg.error('La dirección debe tener la forma usuario@dominio.');
      if (!next.incoming || !next.outgoing || !next.user) return accMsg.error('Completa los servidores y el usuario.');
      pc.mailAccount = next;
      app.afterCommand();
      accMsg.ok('Cuenta guardada.');
    };
    const to = input({ placeholder: 'luis@aula.lab, …' });
    const subject = input();
    const body = el('textarea', { rows: '5', 'aria-label': 'Mensaje' });
    const sendMsg = message();
    const send = (): void => {
      if (!pc.mailAccount) return sendMsg.error('Configura y guarda la cuenta primero.');
      const r = sendMail(pc, pc.mailAccount, to.value.split(',').map((x) => x.trim()).filter(Boolean), subject.value, body.value);
      app.afterCommand();
      if (r.ok) { to.value = ''; subject.value = ''; body.value = ''; sendMsg.ok(`Enviado. Servidor: ${r.text}`); } else sendMsg.error(r.text);
    };
    const recvMsg = message();
    const receive = (): void => {
      if (!pc.mailAccount) return recvMsg.error('Configura y guarda la cuenta primero.');
      const r = receiveMail(pc, pc.mailAccount);
      app.afterCommand();
      if (!r.ok) return recvMsg.error(r.text);
      pc.inbox = pc.mailAccount.protocol === 'IMAP' ? [...r.messages] : [...pc.inbox, ...r.messages];
      reading = -1;
      refresh();
    };
    const open = pc.inbox[reading];
    return [
      el('details', { class: 'account', open: !pc.mailAccount },
        el('summary', {}, pc.mailAccount ? `Cuenta: ${pc.mailAccount.address} (${pc.mailAccount.protocol})` : 'Configurar cuenta de correo'),
        el('div', { class: 'grid3' }, field('Tu nombre', f.name), field('Dirección', f.address), field('Protocolo de entrada', f.protocol),
          field('Servidor entrante', f.incoming), field('Servidor saliente (SMTP)', f.outgoing), field('Usuario', f.user), field('Contraseña', f.password)),
        el('div', { class: 'actions' }, button('Guardar cuenta', saveAccount)), accMsg.el),
      el('h3', {}, 'Redactar'),
      el('div', { class: 'grid2' }, field('Para', to), field('Asunto', subject)), field('Mensaje', body),
      el('div', { class: 'actions' }, button('Enviar', send)), sendMsg.el,
      el('h3', {}, 'Bandeja de entrada'),
      el('div', { class: 'actions' }, button('Recibir', receive)), recvMsg.el,
      table(pc.inbox.map((m, i) => ({ m, i })), [
        { label: 'De', value: (x) => x.m.from, mono: true }, { label: 'Asunto', value: (x) => x.m.subject || '(sin asunto)' }, { label: 'Fecha', value: (x) => formatLeaseTime(x.m.date) },
      ], { empty: 'Sin mensajes. Pulsa Recibir.', onSelect: (x) => { reading = x.i; refresh(); }, selected: (x) => x.i === reading }),
      open ? el('article', { class: 'mail-read' }, el('h4', {}, open.subject || '(sin asunto)'), el('p', { class: 'muted' }, `De ${open.from} para ${open.to.join(', ')}`), el('pre', { class: 'mail-body' }, open.body)) : null,
    ].filter((x): x is HTMLElement => x !== null);
  });
}
