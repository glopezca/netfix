/**
 * Servicios → Samba of a GNU/Linux server or PC with samba installed: smbd and nmbd on or off, the shares of
 * /etc/samba/smb.conf and the Samba accounts of the Linux users, done as root would do it (shells/samba-admin.ts).
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { button, field, input, message, onOff, select, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Host } from '../devices/host.ts';
import type { SmbShare } from '../services/smb-conf.ts';
import type { SmbAccount } from '../services/smb-passdb.ts';
import {
  addSambaShare, removeSambaAccount, removeSambaShare, sambaView, setSambaAccountDisabled, setSambaPassword, setSambaRunning, shareAccess,
} from '../shells/samba-admin.ts';
import type { SambaError, SambaView } from '../shells/samba-admin.ts';

type Msg = ReturnType<typeof message>;

function sharesSection(host: Host, view: SambaView, app: AfterChange, msg: Msg): HTMLElement {
  const name = input({ placeholder: 'docs', 'aria-label': t('smb.share') });
  const path = input({ placeholder: '/srv/samba/docs', 'aria-label': t('smb.path') });
  const comment = input({ 'aria-label': t('smb.comment') });
  const readOnly = el('input', { type: 'checkbox' });
  const guestOk = el('input', { type: 'checkbox', checked: true });
  const done = (err: SambaError | null): void => {
    if (err) msg.error(t(err)); else msg.clear();
    app.afterCommand();
  };
  const add = (): void => done(addSambaShare(host, { name: name.value, path: path.value, comment: comment.value, readOnly: readOnly.checked, guestOk: guestOk.checked }));
  return el('section', { class: 'subsection' },
    el('h3', {}, t('smb.shares')),
    table<SmbShare>(view.shares, [
      { label: t('smb.share'), value: (s) => s.name, mono: true },
      { label: t('smb.path'), value: (s) => s.path, mono: true },
      { label: t('smb.comment'), value: (s) => s.comment },
      { label: t('smb.access'), value: shareAccess },
    ], { empty: t('smb.noShares'), onDelete: (s) => { removeSambaShare(host, s.name); done(null); } }),
    el('h4', {}, t('smb.addShare')),
    el('div', { class: 'grid3' }, field(t('smb.share'), name), field(t('smb.path'), path), field(t('smb.comment'), comment)),
    el('label', { class: 'check' }, readOnly, ` ${t('smb.readOnly')}`),
    el('label', { class: 'check' }, guestOk, ` ${t('smb.guestOk')}`),
    el('div', { class: 'actions' }, button(t('smb.add'), add)),
    el('p', { class: 'muted' }, t('smb.shareHint')));
}

function accountsSection(host: Host, view: SambaView, app: AfterChange, msg: Msg): HTMLElement {
  const done = (err: SambaError | null): void => {
    if (err) msg.error(t(err)); else msg.clear();
    app.afterCommand();
  };
  const toggle = (a: SmbAccount): HTMLButtonElement => button(a.disabled ? t('smb.enable') : t('smb.disable'), () => {
    setSambaAccountDisabled(host, a.name, !a.disabled);
    done(null);
  }, 'btn btn-small');
  const user = select(view.users.map((u) => [u, u] as const));
  const pass = input({ type: 'password', autocomplete: 'new-password', 'aria-label': t('smb.password') });
  const form = view.users.length
    ? el('div', { class: 'inline-form' }, field(t('smb.user'), user), field(t('smb.password'), pass),
      button(t('smb.setPassword'), () => done(setSambaPassword(host, user.value, pass.value))))
    : el('p', { class: 'muted' }, t('smb.noUsers'));
  return el('section', { class: 'subsection' },
    el('h3', {}, t('smb.accounts')),
    table<SmbAccount>(view.accounts, [
      { label: t('smb.user'), value: (a) => a.name, mono: true },
      { label: t('smb.state'), value: (a) => (a.disabled ? t('smb.disabled') : t('smb.enabled')) },
    ], { empty: t('smb.noAccounts'), actions: (a) => [toggle(a)], onDelete: (a) => { removeSambaAccount(host, a.name); done(null); } }),
    form,
    el('p', { class: 'muted' }, t('smb.accountsHint')));
}

export function sambaPanel(host: Host, app: AfterChange): LivePanel {
  // Outside the redraw: an action redraws the panel (notifyChange) before its error is shown.
  const msg = message();
  return liveHostPanel(host, () => {
    const view = sambaView(host);
    return [
      onOff(t('smb.service'), view.running, (on) => { setSambaRunning(host, on); app.afterCommand(); }),
      el('p', { class: 'muted' }, t('smb.intro')),
      msg.el,
      sharesSection(host, view, app, msg),
      accountsSection(host, view, app, msg),
    ];
  });
}
