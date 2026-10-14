/** PC app "SSH client" (PuTTY-like): saved sessions, a terminal per session, key pairs and known hosts. */
import { el } from './dom.ts';
import { button, field, input, message, select, subnav, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { Terminal } from './terminal.ts';
import type { ConsoleBackend } from './terminal.ts';
import type { Pc } from '../devices/pc.ts';
import { createShell } from '../shells/factory.ts';
import { hostSystem, hostUsers } from '../shells/host-system.ts';
import { SshKeyring } from '../clients/ssh-keyring.ts';
import type { KeyInfo, KnownHost, SshProfile } from '../clients/ssh-keyring.ts';
import { t } from '../i18n/t.ts';

const USER = 'alumno';

/** A pane that draws itself again after each change (keys, known hosts, sessions live in files). */
function redrawable(render: (redraw: () => void) => HTMLElement[], cls = 'pane-part'): HTMLElement {
  const root = el('div', { class: cls });
  const draw = (): void => { root.replaceChildren(...render(draw)); };
  draw();
  return root;
}

function keyring(pc: Pc): SshKeyring | null {
  const acct = hostUsers(pc).find((u) => u.name === USER);
  return acct ? new SshKeyring(hostSystem(pc).fs, acct, pc.runtimeName().toLowerCase()) : null;
}

/** `ssh` command line of a session (values come from validated fields, quoted for bash). */
function sshLine(p: Omit<SshProfile, 'name'>): string {
  const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
  return ['ssh', ...(p.port !== 22 ? ['-p', String(p.port)] : []), ...(p.identity ? ['-i', q(`~/.ssh/${p.identity}`)] : []), q(`${p.user || USER}@${p.host}`)].join(' ');
}

function terminalFor(pc: Pc, p: Omit<SshProfile, 'name'>, app: AfterChange): Terminal {
  const shell = createShell(pc, 'linux', USER);
  const first = shell.run(sshLine(p));
  const backend: ConsoleBackend = {
    prompt: () => shell.prompt(), run: (l) => shell.run(l),
    secret: () => shell.secret(), complete: (l) => shell.complete?.(l) ?? null,
    interrupt: () => shell.interrupt?.() ?? [], eof: () => shell.eof?.() ?? [],
    editRequest: () => shell.editRequest?.() ?? null, saveEdit: (path, c) => (shell.saveEdit ? shell.saveEdit(path, c) : t('common.unavailable')),
    closeEdit: () => shell.closeEdit?.() ?? [],
    screenFrame: (w, h) => shell.screenFrame?.(w, h) ?? null, screenKey: (k) => shell.screenKey?.(k) ?? [],
  };
  return new Terminal(backend, { intro: first, label: `SSH ${p.user || USER}@${p.host}`, afterRun: () => app.afterCommand() });
}

function sessionPane(pc: Pc, ring: SshKeyring, app: AfterChange): HTMLElement {
  const msg = message();
  const host = input({ placeholder: '10.0.0.2', 'aria-label': t('ssh.host') });
  const port = input({ value: '22', inputmode: 'numeric', 'aria-label': t('ssh.port') });
  const user = input({ value: USER, 'aria-label': t('ssh.user') });
  const ident = select([['', t('ssh.defaultKeys')], ...ring.keys().map((k) => [k.name, k.name] as const)], '');
  const name = input({ placeholder: 'servidor-web', 'aria-label': t('ssh.name') });
  const term = el('div', { class: 'ssh-term' });
  const profile = (): Omit<SshProfile, 'name'> => ({ host: host.value.trim(), port: Number(port.value) || 22, user: user.value.trim(), identity: ident.value });
  const close = button(t('ssh.close'), () => { term.replaceChildren(); close.hidden = true; }, 'btn btn-small');
  close.hidden = true;
  const open = (): void => {
    const p = profile();
    if (!/^[\w.-]{1,253}$/.test(p.host) || !(p.port >= 1 && p.port <= 65535) || !/^[\w.-]{0,32}$/.test(p.user)) return msg.error(t('ssh.badProfile'));
    msg.clear();
    const tm = terminalFor(pc, p, app);
    term.replaceChildren(tm.root);
    close.hidden = false;
    tm.focus();
  };
  const fill = (p: SshProfile): void => { host.value = p.host; port.value = String(p.port); user.value = p.user; ident.value = p.identity; name.value = p.name; };
  const saved = redrawable((redraw) => [
    el('h3', {}, t('ssh.saved')),
    table<SshProfile>(ring.profiles(), [{ label: t('ssh.name'), value: (p) => p.name }, { label: t('ssh.host'), value: (p) => `${p.user}@${p.host}:${p.port}`, mono: true }], {
      empty: t('ssh.noSaved'), onSelect: fill, onDelete: (p) => { ring.deleteProfile(p.name); app.afterCommand(); redraw(); },
    }),
    el('div', { class: 'row-actions' }, name, button(t('ssh.save'), () => {
      if (ring.saveProfile({ ...profile(), name: name.value.trim() })) return msg.error(t('ssh.badProfile'));
      app.afterCommand();
      redraw();
    }, 'btn btn-small')),
  ]);
  return el('div', { class: 'pane' }, el('p', { class: 'muted' }, t('ssh.intro')), msg.el,
    el('div', { class: 'grid2' }, field(t('ssh.host'), host), field(t('ssh.port'), port), field(t('ssh.user'), user), field(t('ssh.identity'), ident)),
    el('div', { class: 'row-actions' }, button(t('ssh.open'), open), close),
    term, saved);
}

function keysPane(ring: SshKeyring, app: AfterChange): HTMLElement {
  const msg = message();
  const type = select([['ed25519', 'ed25519'], ['ecdsa', 'ecdsa'], ['rsa', 'rsa 3072']], 'ed25519');
  const file = input({ value: 'id_ed25519', 'aria-label': t('ssh.keyName') });
  type.addEventListener('change', () => { file.value = `id_${type.value}`; });
  const pass = input({ type: 'password', autocomplete: 'new-password', 'aria-label': t('ssh.passphrase') });
  const copy = (k: KeyInfo): void => { void globalThis.navigator?.clipboard?.writeText(k.publicLine).then(() => msg.ok(t('ssh.copied'))); };
  let refresh = (): void => undefined;
  const list = redrawable((redraw) => { refresh = redraw; return [table<KeyInfo>(ring.keys(), [
    { label: t('ssh.keyName'), value: (k) => `${k.name}${k.encrypted ? ` (${t('ssh.encrypted')})` : ''}` },
    { label: t('ssh.keyType'), value: (k) => k.type, mono: true },
    { label: t('ssh.fingerprint'), value: (k) => k.fingerprint, mono: true },
  ], { empty: t('ssh.noKeys'), actions: (k) => [button(t('ssh.copy'), () => copy(k), 'btn btn-small')], onDelete: (k) => { ring.deleteKey(k.name); app.afterCommand(); redraw(); } })]; });
  const gen = (): void => {
    const err = ring.generate(type.value as 'ed25519' | 'ecdsa' | 'rsa', file.value.trim(), pass.value);
    if (err) return msg.error(t(err === 'exists' ? 'ssh.keyExists' : err === 'name' ? 'ssh.keyBadName' : 'ssh.keyWrite'));
    pass.value = '';
    msg.clear();
    app.afterCommand();
    refresh();
  };
  return el('div', { class: 'pane' }, el('p', { class: 'muted' }, t('ssh.keysIntro')), msg.el, list,
    el('div', { class: 'grid2' }, field(t('ssh.keyType'), type), field(t('ssh.keyName'), file), field(t('ssh.passphrase'), pass)),
    el('div', { class: 'row-actions' }, button(t('ssh.generate'), gen)));
}

function knownPane(ring: SshKeyring, app: AfterChange): HTMLElement {
  return redrawable((redraw) => [el('p', { class: 'muted' }, t('ssh.knownIntro')), table<KnownHost>(ring.knownHosts(), [
    { label: t('ssh.host'), value: (k) => k.host, mono: true }, { label: t('ssh.keyType'), value: (k) => k.type, mono: true }, { label: t('ssh.fingerprint'), value: (k) => k.fingerprint, mono: true },
  ], { empty: t('ssh.noKnown'), actions: (k) => [button(t('ssh.forget'), () => { ring.forgetHost(k.line); app.afterCommand(); redraw(); }, 'btn btn-small danger')] })], 'pane');
}

export function sshApp(pc: Pc, app: AfterChange): HTMLElement {
  const ring = keyring(pc);
  if (!ring) return el('p', { class: 'muted' }, t('common.unavailable'));
  return subnav([
    { id: 'session', label: t('ssh.session'), render: () => sessionPane(pc, ring, app) },
    { id: 'keys', label: t('ssh.keys'), render: () => keysPane(ring, app) },
    { id: 'known', label: t('ssh.known'), render: () => knownPane(ring, app) },
  ]);
}
