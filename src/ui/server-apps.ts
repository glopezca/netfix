/** Server-PT → Servicios → HTTP, Correo, SSH and Registros panels. */
import { el } from './dom.ts';
import { field, input, select, button, onOff, message, table, subnav } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { livePanel, dhcpPanel, dnsPanel } from './server-dhcp-dns.ts';
import type { Server } from '../devices/server.ts';
import type { Account } from '../services/config.ts';
import { validateFileName } from '../services/http-service.ts';
import { UNITS, unitActive } from '../services/units.ts';
import { createShell } from '../shells/factory.ts';

export function servicesTab(server: Server, app: AfterChange): HTMLElement {
  return subnav([
    { id: 'dhcp', label: 'DHCP', render: () => dhcpPanel(server, app) },
    { id: 'dns', label: 'DNS', render: () => dnsPanel(server, app) },
    { id: 'http', label: 'HTTP', render: () => httpPanel(server, app) },
    { id: 'mail', label: 'Correo', render: () => mailPanel(server, app) },
    { id: 'ssh', label: 'SSH', render: () => sshPanel(server, app) },
    { id: 'log', label: 'Registros', render: () => logPanel(server) },
  ]);
}

function httpPanel(server: Server, app: AfterChange): HTMLElement {
  let current = server.services.http.files[0]?.name ?? null;
  return livePanel((refresh) => {
    const s = server.services;
    const file = s.http.files.find((f) => f.name === current);
    const editor = el('textarea', { class: 'code-editor', rows: '14', spellcheck: 'false', 'aria-label': 'Contenido del fichero' });
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
      onOff('Servicio HTTP (puerto 80)', s.http.enabled, (on) => { server.setUnit('http', on); app.afterCommand(); refresh(); }),
      el('p', { class: 'muted' }, 'Pruébalo desde un PC con el navegador, curl o wget. HTTPS no está simulado.'),
      el('div', { class: 'file-layout' },
        el('div', { class: 'file-list' }, table(s.http.files, [{ label: 'Fichero', value: (f) => f.name, mono: true }], {
          empty: 'Sin ficheros: el servidor responderá 404.', onSelect: (f) => { current = f.name; refresh(); }, selected: (f) => f.name === current,
          onDelete: (f) => { if (current === f.name) current = null; setFiles(s.http.files.filter((x) => x !== f)); },
        }), el('div', { class: 'inline-form' }, field('Nuevo fichero', newName), button('Crear', create))),
        el('div', { class: 'file-edit' }, file ? field(`Editar ${file.name}`, editor) : el('p', { class: 'muted' }, 'Selecciona o crea un fichero.'),
          file ? el('div', { class: 'actions' }, button('Guardar', () => { setFiles(s.http.files.map((f) => (f.name === file.name ? { ...f, content: editor.value } : f))); })) : null)),
      msg.el,
    ];
  });
}

function accounts(list: readonly Account[], onChange: (next: readonly Account[]) => void, what: string): HTMLElement {
  const user = input({ placeholder: 'usuario' });
  const pass = input({ placeholder: 'contraseña', type: 'password' });
  const msg = message();
  const add = (): void => {
    const name = user.value.trim();
    if (!/^[a-z0-9._-]{1,32}$/i.test(name)) return msg.error('Usuario: letras, números, punto, guion o guion bajo.');
    if (!pass.value) return msg.error('Escribe una contraseña.');
    if (list.some((u) => u.name === name)) return msg.error(`Ya existe ${name}.`);
    onChange([...list, { name, password: pass.value }]);
  };
  return el('section', { class: 'subsection' },
    el('h3', {}, `Usuarios ${what}`),
    el('div', { class: 'inline-form' }, field('Usuario', user), field('Contraseña', pass), button('Añadir', add)), msg.el,
    table(list, [{ label: 'Usuario', value: (u) => u.name, mono: true }, { label: 'Contraseña', value: () => '••••••' }], { empty: 'Sin usuarios.', onDelete: (u) => onChange(list.filter((x) => x !== u)) }));
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
      onOff('SMTP (puerto 25 · postfix)', m.smtp, (on) => set({ smtp: on })),
      onOff('POP3 (puerto 110 · dovecot)', m.pop3, (on) => set({ pop3: on })),
      onOff('IMAP (puerto 143 · dovecot)', m.imap, (on) => set({ imap: on })),
      field('Dominio de correo', domain, 'Las direcciones serán usuario@dominio. El correo a otros dominios se reenvía por su registro MX.'),
      accounts(m.users, (users) => set({ users }), 'de correo'),
      el('h3', {}, 'Buzones'),
      table(m.users, [{ label: 'Usuario', value: (u) => `${u.name}@${m.domain || '…'}`, mono: true }, { label: 'Mensajes', value: (u) => String(server.mailboxes.list(u.name).length) }], { empty: 'Sin buzones.' }),
    ];
  });
}

function sshPanel(server: Server, app: AfterChange): HTMLElement {
  return livePanel((refresh) => {
    const s = server.services;
    return [
      onOff('Servicio SSH (puerto 22)', s.ssh.enabled, (on) => { server.setUnit('ssh', on); app.afterCommand(); refresh(); }),
      el('p', { class: 'muted' }, `Desde un PC: ssh usuario@${server.config.ip !== undefined ? 'IP-del-servidor' : 'servidor'} en el Terminal o en el Símbolo del sistema. La sesión abre la shell ${server.os === 'windows' ? 'de Windows' : 'de Ubuntu'} de este servidor.`),
      accounts(s.ssh.users, (users) => { server.setServices({ ...server.services, ssh: { ...server.services.ssh, users } }); app.afterCommand(); refresh(); }, 'SSH'),
      el('h3', {}, 'Sesiones abiertas'),
      table(server.ssh.activeSessions(), [{ label: 'Sesión', value: (x) => x.id, mono: true }, { label: 'Usuario', value: (x) => x.user }], { empty: 'Ninguna.' }),
    ];
  });
}

function logPanel(server: Server): HTMLElement {
  let selected = UNITS[0]?.linux ?? 'ssh';
  return livePanel((refresh) => {
    const unit = select(UNITS.map((u) => [u.linux, `${u.linux} (${unitActive(server.services, u.id) ? 'activo' : 'parado'})`] as const), selected);
    const out = el('pre', { class: 'log-view' });
    const show = (): void => {
      selected = unit.value;
      out.textContent = createShell(server, 'linux', 'root').run(`journalctl -u ${unit.value} -n 100`).join('\n');
    };
    unit.addEventListener('change', show);
    show();
    return [el('div', { class: 'inline-form' }, field('Servicio', unit), button('Actualizar', () => { refresh(); })), out,
      el('p', { class: 'muted' }, 'Equivale a journalctl -u <servicio> en el terminal del servidor.')];
  });
}
