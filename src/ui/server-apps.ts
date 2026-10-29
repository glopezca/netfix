/** Server → Servicios: SSH first, then DHCP, DNS, HTTP, Correo, Registros and Ficheros. */
import { t } from '../i18n/t.ts';
import { firewallPanel, sysctlPanel } from './firewall-panel.ts';
import { vpnPanel } from './vpn-panel.ts';
import { el } from './dom.ts';
import { field, input, select, button, onOff, message, table, subnav } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { livePanel, dhcpPanel } from './server-dhcp-dns.ts';
import { dnsPanel } from './server-dns.ts';
import { filesPanel } from './files-panel.ts';
import { fillSyntax } from './syntax-view.ts';
import type { Server } from '../devices/server.ts';
import type { Account, WebAppAccess } from '../services/config.ts';
import { validateAccess } from '../services/config.ts';
import { formatIp } from '../core/ip.ts';
import { validateFileName } from '../services/http-service.ts';
import { logUnits, unitActive } from '../services/units.ts';
import { createShell } from '../shells/factory.ts';
import { sshAuthMethods, setSshAuthMethods } from '../services/ssh-auth-settings.ts';

/**
 * The panels of the tab that Configuración → Laboratorio actual leaves on (`panels`: feature ids), in this order:
 * kernel parameters, firewall, VPN, then SSH, DHCP, DNS, HTTP, mail, files and logs.
 */
export function servicesTab(server: Server, app: AfterChange, panels: readonly string[]): HTMLElement {
  const all = [
    { id: 'sysctl', label: t('sysctl.tab'), render: () => sysctlPanel(server, app).root },
    { id: 'firewall', label: t('fw.tab'), render: () => firewallPanel(server, app).root },
    ...(server.kind === 'linuxrouter' ? [{ id: 'vpn', label: t('vpn.tab'), render: () => vpnPanel(server, app).root }] : []),
    ...servicePanels(server, app),
  ];
  return subnav(all.filter((p) => panels.includes(p.id)));
}

function servicePanels(server: Server, app: AfterChange): { id: string; label: string; render: () => HTMLElement }[] {
  return [
    { id: 'ssh', label: 'SSH', render: () => sshPanel(server, app) },
    { id: 'dhcp', label: 'DHCP', render: () => dhcpPanel(server, app) },
    { id: 'dns', label: 'DNS', render: () => dnsPanel(server, app) },
    { id: 'http', label: 'HTTP', render: () => httpPanel(server, app) },
    { id: 'mail', label: t('srv.mail'), render: () => mailPanel(server, app) },
    // Windows Server keeps its configuration in the registry, not in files a teacher would open.
    ...(server.os === 'linux' ? [{ id: 'files', label: t('srv.files'), render: () => filesPanel(server) }] : []),
    { id: 'log', label: t('srv.log'), render: () => logPanel(server) },
  ];
}

function httpPanel(server: Server, app: AfterChange): HTMLElement {
  let current = server.services.http.files[0]?.name ?? null;
  return livePanel((refresh) => {
    const s = server.services;
    const file = s.http.files.find((f) => f.name === current);
    const editor = el('textarea', { class: 'code-editor', rows: '14', spellcheck: 'false', 'aria-label': t('srv.fileContent') });
    editor.value = file?.content ?? '';
    const newName = input({ placeholder: 'contacto.html' });
    const msg = message();
    const setFiles = (files: typeof s.http.files): void => {
      server.setServices({ ...server.services, http: { ...server.services.http, files } });
      app.afterCommand();
      refresh();
    };
    const create = (): void => {
      const name = newName.value.trim();
      const err = validateFileName(name, s.http.files);
      if (err) return msg.error(err);
      current = name;
      setFiles([...s.http.files, { name, content: `<!doctype html>\n<html><head><title>${name}</title></head>\n<body>\n<h1>${name}</h1>\n</body></html>` }]);
    };
    return [
      onOff(server.os === 'windows' ? t('srv.httpIis') : t('srv.httpApache', { ports: server.web.httpPorts().join(', ') || '80' }), s.http.enabled, (on) => { server.setUnit('http', on); app.afterCommand(); refresh(); }),
      el('p', { class: 'muted' }, server.os === 'windows'
        ? t('srv.httpWin')
        : t('srv.httpLinux')),
      webAppsSection(server, app, refresh),
      el('div', { class: 'file-layout' },
        el('div', { class: 'file-list' }, table(s.http.files, [{ label: t('srv.file'), value: (f) => f.name, mono: true }], {
          empty: t('srv.noFiles'), onSelect: (f) => { current = f.name; refresh(); }, selected: (f) => f.name === current,
          onDelete: (f) => { if (current === f.name) current = null; setFiles(s.http.files.filter((x) => x !== f)); },
        }), el('div', { class: 'inline-form' }, field(t('srv.newFile'), newName), button(t('srv.create'), create))),
        el('div', { class: 'file-edit' }, file ? field(t('srv.edit', { name: file.name }), editor) : el('p', { class: 'muted' }, t('srv.pickFile')),
          file ? el('div', { class: 'actions' }, button(t('srv.save'), () => { setFiles(s.http.files.map((f) => (f.name === file.name ? { ...f, content: editor.value } : f))); })) : null)),
      msg.el,
    ];
  });
}

/** Roundcube and the management GUI: on/off, alias or own port (and the GUI's login). */
function webAppsSection(server: Server, app: AfterChange, refresh: () => void): HTMLElement {
  const w = server.services.webapps;
  const msg = message();
  const accessForm = (title: string, a: WebAppAccess, extra: HTMLElement[], save: (next: WebAppAccess) => string | null): HTMLElement => {
    const enabled = el('input', { type: 'checkbox', checked: a.enabled });
    const mode = select([['alias', t('srv.aliasMode')], ['port', t('srv.portMode')]], a.mode);
    const alias = input({ value: a.alias });
    const port = input({ value: String(a.port), inputmode: 'numeric' });
    const apply = (): void => {
      const err = save({ enabled: enabled.checked, mode: mode.value === 'port' ? 'port' : 'alias', alias: alias.value.trim(), port: Number(port.value) });
      if (err) { msg.error(err); return; }
      app.afterCommand();
      refresh();
    };
    return el('section', { class: 'subsection' }, el('h3', {}, title), el('label', { class: 'check' }, enabled, ` ${t('srv.enabled')}`),
      el('div', { class: 'grid3' }, field(t('srv.access'), mode), field(t('srv.alias'), alias), field(t('srv.port'), port)), ...extra, el('div', { class: 'actions' }, button(t('srv.apply'), apply)));
  };
  const host = server.config.ip !== undefined ? formatIp(server.config.ip) : t('srv.serverIp');
  const where = (a: WebAppAccess): string => (a.mode === 'port' ? `http://${host}:${a.port}/` : `http://${host}${a.alias}/`);
  const user = input({ value: w.admin.user });
  const pass = input({ value: w.admin.password, type: 'password' });
  return el('div', {},
    el('h3', {}, t('srv.webApps')),
    el('p', { class: 'muted' }, t('srv.webAppsState', { rc: w.roundcube.enabled ? where(w.roundcube) : t('srv.disabled'), admin: w.admin.enabled ? where(w.admin) : t('srv.disabledF') })),
    accessForm(t('srv.admin'), w.admin, [el('div', { class: 'grid2' }, field(t('srv.user'), user), field(t('srv.password'), pass))], (next) => {
      const err = validateAccess(next, server.services.webapps.roundcube) ?? (user.value.trim() && pass.value ? null : t('srv.needCreds'));
      if (err) return err;
      server.setServices({ ...server.services, webapps: { ...server.services.webapps, admin: { ...next, user: user.value.trim(), password: pass.value } } });
      return null;
    }),
    accessForm(t('srv.roundcube'), w.roundcube, [], (next) => validateAccess(next, server.services.webapps.admin) ?? (server.setServices({ ...server.services, webapps: { ...server.services.webapps, roundcube: next } }), null)),
    msg.el);
}

function accounts(list: readonly Account[], onChange: (next: readonly Account[]) => void, what: string): HTMLElement {
  const user = input({ placeholder: t('srv.userPlaceholder') });
  const pass = input({ placeholder: t('srv.passPlaceholder'), type: 'password' });
  const msg = message();
  const add = (): void => {
    const name = user.value.trim();
    if (!/^[a-z0-9._-]{1,32}$/i.test(name)) return msg.error(t('srv.badUser'));
    if (!pass.value) return msg.error(t('srv.needPass'));
    if (list.some((u) => u.name === name)) return msg.error(t('srv.exists', { name }));
    onChange([...list, { name, password: pass.value }]);
  };
  return el('section', { class: 'subsection' },
    el('h3', {}, what),
    el('div', { class: 'inline-form' }, field(t('srv.user'), user), field(t('srv.password'), pass), button(t('srv.add'), add)), msg.el,
    table(list, [{ label: t('srv.user'), value: (u) => u.name, mono: true }, { label: t('srv.password'), value: () => '••••••' }], { empty: t('srv.noUsers'), onDelete: (u) => onChange(list.filter((x) => x !== u)) }));
}

function mailPanel(server: Server, app: AfterChange): HTMLElement {
  return livePanel((refresh) => {
    const s = server.services;
    const m = s.mail;
    const set = (next: Partial<typeof m>): void => {
      server.setServices({ ...server.services, mail: { ...server.services.mail, ...next } });
      app.afterCommand();
      refresh();
    };
    const domain = input({ value: m.domain, placeholder: 'aula.lab' });
    domain.addEventListener('change', () => set({ domain: domain.value.trim().toLowerCase() }));
    return [
      onOff(t('srv.smtp'), m.smtp, (on) => set({ smtp: on })),
      onOff(t('srv.pop3'), m.pop3, (on) => set({ pop3: on })),
      onOff(t('srv.imap'), m.imap, (on) => set({ imap: on })),
      field(t('srv.mailDomain'), domain, t('srv.mailDomainHint')),
      accounts(m.users, (users) => set({ users }), t('srv.mailUsers')),
      el('h3', {}, t('srv.mailboxes')),
      table(m.users, [{ label: t('srv.user'), value: (u) => `${u.name}@${m.domain || '…'}`, mono: true }, { label: t('srv.messages'), value: (u) => String(server.mailboxes.list(u.name).length) }], { empty: t('srv.noMailboxes') }),
    ];
  });
}

/** PasswordAuthentication / PubkeyAuthentication switches (Ubuntu servers only). */
function sshAuthControls(server: Server, app: AfterChange, refresh: () => void, notice: { error: string }): HTMLElement[] {
  const auth = sshAuthMethods(server);
  if (!auth) return [];
  const msg = message();
  if (notice.error) msg.error(notice.error);
  notice.error = '';
  const change = (want: { password: boolean; pubkey: boolean }): void => {
    notice.error = setSshAuthMethods(server, want) ?? '';
    app.afterCommand();
    refresh();
  };
  return [
    el('h3', {}, t('srv.auth')),
    onOff(t('srv.authPassword'), auth.password, (on) => change({ ...auth, password: on })),
    onOff(t('srv.authPubkey'), auth.pubkey, (on) => change({ ...auth, pubkey: on })),
    el('p', { class: 'muted' }, t('srv.authHint')),
    msg.el,
  ];
}

function sshPanel(server: Server, app: AfterChange): HTMLElement {
  const notice = { error: '' };
  return livePanel((refresh) => {
    const s = server.services;
    return [
      onOff(t('srv.sshService'), s.ssh.enabled, (on) => { server.setUnit('ssh', on); app.afterCommand(); refresh(); }),
      el('p', { class: 'muted' }, t(server.os === 'windows' ? 'srv.sshWin' : 'srv.sshLinux', { host: server.config.ip !== undefined ? t('srv.serverIp') : t('srv.server') })),
      ...sshAuthControls(server, app, refresh, notice),
      accounts(s.ssh.users, (users) => { server.setServices({ ...server.services, ssh: { ...server.services.ssh, users } }); app.afterCommand(); refresh(); }, t('srv.sshUsers')),
      el('h3', {}, t('srv.sessions')),
      table(server.ssh.activeSessions(), [{ label: t('srv.session'), value: (x) => x.id, mono: true }, { label: t('srv.user'), value: (x) => x.user }], { empty: t('srv.none') }),
    ];
  });
}

function logPanel(server: Server): HTMLElement {
  const units = logUnits(server.kind);
  let selected = units[0]?.linux ?? 'ssh';
  return livePanel((refresh) => {
    const unit = select(units.map((u) => [u.linux, `${u.linux} (${unitActive(server.services, u.id) ? t('srv.active') : t('srv.stopped')})`] as const), selected);
    const out = el('pre', { class: 'log-view' });
    const show = (): void => {
      selected = unit.value;
      fillSyntax(out, createShell(server, 'linux', 'root').run(`journalctl -u ${unit.value} -n 100`).join('\n'), 'messages');
    };
    unit.addEventListener('change', show);
    show();
    return [el('div', { class: 'inline-form' }, field(t('srv.service'), unit), button(t('srv.refresh'), () => { refresh(); })), out,
      el('p', { class: 'muted' }, t('srv.journalHint'))];
  });
}
