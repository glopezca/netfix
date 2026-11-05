/**
 * Servicios → Samba of the management GUI (Server or GNU/Linux router with samba installed): what the Samba panel of
 * the device does (shells/samba-admin.ts), as forms: smbd and nmbd on or off, the shares of smb.conf and the Samba
 * accounts of the Linux users.
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, cards, check, choose, form, row, section, text } from './admin-layout.ts';
import { table } from './admin-pages.ts';
import type { Fields, Outcome } from './admin-actions.ts';
import {
  addSambaShare, removeSambaAccount, removeSambaShare, sambaView, setSambaAccountDisabled, setSambaPassword, setSambaRunning, shareAccess,
} from '../shells/samba-admin.ts';
import type { SambaError } from '../shells/samba-admin.ts';

const PAGE = 'samba';

/** A one-button form on a row of a table (the share or account it acts on, hidden). */
function rowButton(base: string, action: string, key: 'name' | 'user', value: string, label: string): Markup {
  return form(base, PAGE, action, h('input', { type: 'hidden', name: key, value }), h('button', { type: 'submit', class: 'web-adm-small' }, label));
}

function shares(server: Server, base: string): Child {
  const rows = sambaView(server).shares.map((s) => [h('span', { class: 'web-adm-mono' }, s.name), h('span', { class: 'web-adm-mono' }, s.path), s.comment, shareAccess(s),
    rowButton(base, 'smb-share-del', 'name', s.name, t('wa.remove'))]);
  return [
    cards(section(t('smb.shares'), t('smb.intro'), table([t('smb.share'), t('smb.path'), t('smb.comment'), t('smb.access'), ''], rows, t('smb.noShares')))),
    form(base, PAGE, 'smb-share-add', cards(section(t('smb.addShare'), t('smb.shareHint'),
      row(t('smb.share'), text('name', '', { placeholder: 'docs' })), row(t('smb.path'), text('path', '', { placeholder: '/srv/samba/docs' })),
      row(t('smb.comment'), text('comment', '')), check('readOnly', false, t('smb.readOnly')), check('guestOk', true, t('smb.guestOk')))), buttons(t('smb.add'))),
  ];
}

function accounts(server: Server, base: string): Child {
  const view = sambaView(server);
  const rows = view.accounts.map((a) => [h('span', { class: 'web-adm-mono' }, a.name), a.disabled ? t('smb.disabled') : t('smb.enabled'),
    [rowButton(base, 'smb-acct-toggle', 'user', a.name, a.disabled ? t('smb.enable') : t('smb.disable')), rowButton(base, 'smb-acct-del', 'user', a.name, t('wa.remove'))]]);
  const password = view.users.length
    ? form(base, PAGE, 'smb-passwd', cards(section(t('smb.setPassword'), t('smb.accountsHint'),
      row(t('smb.user'), choose('user', view.users[0] ?? '', view.users.map((u) => [u, u]))),
      row(t('smb.password'), h('input', { type: 'password', name: 'password', autocomplete: 'new-password' })))), buttons(t('smb.setPassword')))
    : h('p', { class: 'web-adm-muted' }, t('smb.noUsers'));
  return [cards(section(t('smb.accounts'), '', table([t('smb.user'), t('smb.state'), ''], rows, t('smb.noAccounts')))), password];
}

export function sambaPage(server: Server, base: string): Child {
  return [
    form(base, PAGE, 'smb-service', cards(section(t('smb.service'), '', check('enabled', sambaView(server).running, t('wa.enabled')))), buttons()),
    shares(server, base),
    accounts(server, base),
  ];
}

const done = (err: SambaError | null): Outcome => (err ? { error: t(err) } : { ok: t('wa.saved') });

/** The Samba forms; null for an action of another page. */
export function sambaAction(server: Server, f: Fields): Outcome | null {
  const get = (k: string): string => f.get(k) ?? '';
  switch (get('action')) {
    case 'smb-service': setSambaRunning(server, f.has('enabled')); return done(null);
    case 'smb-share-add': return done(addSambaShare(server, { name: get('name'), path: get('path'), comment: get('comment'), readOnly: f.has('readOnly'), guestOk: f.has('guestOk') }));
    case 'smb-share-del': removeSambaShare(server, get('name')); return done(null);
    case 'smb-passwd': return done(setSambaPassword(server, get('user'), get('password')));
    case 'smb-acct-toggle': {
      const account = sambaView(server).accounts.find((a) => a.name === get('user'));
      if (!account) return done('smb.err.user');
      setSambaAccountDisabled(server, account.name, !account.disabled);
      return done(null);
    }
    case 'smb-acct-del': removeSambaAccount(server, get('user')); return done(null);
    default: return null;
  }
}
