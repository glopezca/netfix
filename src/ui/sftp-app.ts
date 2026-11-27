/** PC app "Files (SFTP)" (FileZilla-like): quick connect bar, message log, local and remote panes. */
import { el } from './dom.ts';
import { button, input } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Pc } from '../devices/pc.ts';
import type { SftpEntry } from '../net/packets.ts';
import { hostSystem, hostUsers } from '../shells/host-system.ts';
import { FileTransfer } from '../clients/file-transfer.ts';
import { drive, type Steps } from '../net/live-wait.ts';
import { t } from '../i18n/t.ts';

const USER = 'alumno';
const engines = new WeakMap<Pc, FileTransfer>();
const KIB = 1024;

function engineFor(pc: Pc): FileTransfer | null {
  const found = engines.get(pc);
  if (found) return found;
  const acct = hostUsers(pc).find((u) => u.name === USER);
  if (!acct) return null;
  const e = new FileTransfer(pc, hostSystem(pc).fs, acct);
  engines.set(pc, e);
  return e;
}

const size = (e: SftpEntry): string => (e.kind === 'dir' ? '' : e.size < KIB ? `${e.size} B` : `${(e.size / KIB).toFixed(1)} KiB`);
const perms = (e: SftpEntry): string => `${e.kind === 'dir' ? 'd' : '-'}${'rwxrwxrwx'.split('').map((c, i) => ((e.mode >> (8 - i)) & 1 ? c : '-')).join('')}`;
const date = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

interface PaneOpts {
  readonly title: string;
  readonly path: string;
  readonly entries: readonly SftpEntry[];
  readonly selected: string | null;
  select(name: string): void;
  open(name: string): void;
}

function pane(o: PaneOpts): HTMLElement {
  const sorted = [...o.entries].sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name));
  const row = (e: SftpEntry): HTMLElement => {
    const tr = el('tr', { class: e.name === o.selected ? 'is-current' : '', tabindex: '0', 'aria-selected': String(e.name === o.selected) },
      el('td', {}, `${e.kind === 'dir' ? '📁 ' : '📄 '}${e.name}`), el('td', { class: 'num' }, size(e)), el('td', { class: 'mono' }, perms(e)), el('td', {}, date(e.mtime)));
    tr.addEventListener('click', () => o.select(e.name));
    tr.addEventListener('dblclick', () => { if (e.kind === 'dir') o.open(e.name); });
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { if (e.kind === 'dir') o.open(e.name); else o.select(e.name); } });
    return tr;
  };
  const up = el('tr', { tabindex: '0' }, el('td', { colspan: '4' }, `⬑ .. (${t('sftp.up')})`));
  up.addEventListener('click', () => o.open('..'));
  up.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') o.open('..'); });
  return el('section', { class: 'ft-pane', 'aria-label': o.title },
    el('div', { class: 'ft-path' }, el('strong', {}, o.title), el('code', { class: 'mono' }, o.path)),
    el('div', { class: 'table-wrap' }, el('table', { class: 'grid-table ft-list' },
      el('thead', {}, el('tr', {}, el('th', {}, t('sftp.name')), el('th', {}, t('sftp.size')), el('th', {}, t('sftp.perms')), el('th', {}, t('sftp.modified')))),
      el('tbody', {}, ...(o.path !== '/' ? [up] : []), ...sorted.map(row)))));
}

function connectBar(ft: FileTransfer, redraw: () => void, run: (steps: Steps<unknown>) => void): HTMLElement {
  const host = input({ placeholder: '10.0.0.2', 'aria-label': t('ssh.host') });
  const user = input({ value: 'admin', 'aria-label': t('ssh.user') });
  const pass = input({ type: 'password', autocomplete: 'off', 'aria-label': t('sftp.password') });
  const port = input({ value: '22', inputmode: 'numeric', class: 'ft-port', 'aria-label': t('ssh.port') });
  const go = (): void => {
    run(ft.connectSteps({ host: host.value.trim(), port: Number(port.value) || 22, user: user.value.trim(), password: pass.value }, {
      hostKey: (h, fp) => globalThis.confirm(t('sftp.hostKey', { host: h, fp })),
      passphrase: (prompt) => globalThis.prompt(prompt) ?? null,
    }));
    pass.value = '';
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const labelled = (text: string, ctrl: HTMLElement): HTMLElement => el('label', { class: 'ft-field' }, el('span', {}, text), ctrl);
  return el('div', { class: 'ft-bar' }, labelled(t('ssh.host'), host), labelled(t('ssh.user'), user), labelled(t('sftp.password'), pass), labelled(t('ssh.port'), port),
    button(t('sftp.connect'), go), ...(ft.session ? [button(t('sftp.disconnect'), () => { ft.disconnect(); redraw(); }, 'btn btn-small')] : []));
}

export function sftpApp(pc: Pc, app: AfterChange): HTMLElement {
  const ft = engineFor(pc);
  const root = el('div', { class: 'pane ft' });
  if (!ft) return root;
  let localSel: string | null = null;
  let remoteSel: string | null = null;
  // The remote listing is kept and asked again after each remote action: a server outside the page answers later (0.94.0).
  let remoteEntries: readonly SftpEntry[] = [];
  let asked = 0; // only the last listing asked is drawn, and only for the session it was asked of (review)
  let busy = false; // one remote action at a time: a second click waits for the first to finish
  const refresh = (): void => {
    const session = ft.session;
    if (!session) { remoteEntries = []; redraw(); return; }
    const n = ++asked;
    void drive(pc.hooks, ft.remoteListSteps()).then((entries) => {
      if (n !== asked || ft.session !== session) return;
      remoteEntries = entries;
      redraw();
    });
  };
  const run = (steps: Steps<unknown>): void => {
    if (busy) return;
    busy = true;
    void drive(pc.hooks, steps).finally(() => { busy = false; refresh(); });
  };
  const redraw = (): void => {
    app.afterCommand();
    const need = (sel: string | null, fn: (n: string) => void): void => { if (sel) fn(sel); else globalThis.alert(t('sftp.select')); };
    const log = el('div', { class: 'ft-log', role: 'log', 'aria-label': t('sftp.log') }, ...ft.log.slice(-60).map((l) => el('div', { class: `ft-${l.kind}` }, l.text)));
    const local = pane({ title: t('sftp.local'), path: ft.localDir, entries: ft.localList(), selected: localSel, select: (n) => { localSel = n; redraw(); }, open: (n) => { ft.localCd(n); localSel = null; redraw(); } });
    const remote = ft.session
      ? pane({ title: `${t('sftp.remote')} · ${ft.target}`, path: ft.session.cwd, entries: remoteEntries, selected: remoteSel, select: (n) => { remoteSel = n; redraw(); }, open: (n) => { remoteSel = null; run(ft.remoteCdSteps(n)); } })
      : el('section', { class: 'ft-pane' }, el('p', { class: 'muted' }, t('sftp.notConnected')));
    const actions = el('div', { class: 'row-actions ft-actions' },
      button(t('sftp.upload'), () => need(localSel, (n) => run(ft.uploadSteps(n)))), button(t('sftp.download'), () => need(remoteSel, (n) => run(ft.downloadSteps(n)))),
      button(t('sftp.mkdir'), () => { const n = globalThis.prompt(t('sftp.askName')); if (n) run(ft.remoteSteps('mkdir', n)); }, 'btn btn-small'),
      button(t('sftp.rename'), () => need(remoteSel, (n) => { const to = globalThis.prompt(t('sftp.askName'), n); if (to) run(ft.remoteSteps('rename', n, to)); }), 'btn btn-small'),
      button(t('sftp.delete'), () => need(remoteSel, (n) => { if (globalThis.confirm(t('sftp.confirmDelete', { name: n }))) run(ft.remoteSteps('delete', n)); }), 'btn btn-small danger'),
      button(t('sftp.refresh'), refresh, 'btn btn-small'));
    root.replaceChildren(connectBar(ft, redraw, run), log, el('div', { class: 'ft-panes' }, local, remote), ...(ft.session ? [actions] : []));
    log.scrollTop = log.scrollHeight;
  };
  refresh();
  return root;
}
