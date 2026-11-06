/**
 * Servicios → SMB of a Windows PC or Server with «Compartir archivos e impresoras para redes Microsoft» ticked in its
 * Configuración tab: the folders of drive C: it shares and what Everyone may do in each (the same as net share,
 * shells/win-net-share.ts). Shares and remarks are the user's: they reach the page only as text.
 */
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { el } from './dom.ts';
import { button, field, input, message, select, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Host } from '../devices/host.ts';
import { winShares } from '../net/win-shares.ts';
import type { ShareAccess, WinShare } from '../net/win-shares.ts';
import { publishWinShare, unpublishWinShare } from '../services/smb-windows.ts';
import type { PublishError } from '../services/smb-windows.ts';

const ERRORS: Readonly<Record<PublishError, MessageKey>> = {
  name: 'wsh.err.name',
  reserved: 'wsh.err.reserved',
  exists: 'smb.err.exists',
  path: 'wsh.err.path',
  folder: 'wsh.err.folder',
  remark: 'wsh.err.remark',
  full: 'wsh.err.full',
};

const accessLabel = (a: ShareAccess): string => t(a === 'full' ? 'wsh.full' : 'wsh.read');

function addForm(host: Host, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement[] {
  const name = input({ placeholder: 'docs', 'aria-label': t('smb.share') });
  const path = input({ placeholder: 'C:\\home\\alumno\\docs', 'aria-label': t('smb.path') });
  const remark = input({ 'aria-label': t('smb.comment') });
  const access = select([['read', t('wsh.read')], ['full', t('wsh.full')]], 'read');
  const add = (): void => {
    const share: WinShare = { name: name.value.trim(), path: path.value.trim(), remark: remark.value, access: access.value === 'full' ? 'full' : 'read' };
    const err = publishWinShare(host, share);
    if (err) msg.error(t(ERRORS[err])); else msg.clear();
    app.afterCommand();
  };
  return [
    el('h4', {}, t('smb.addShare')),
    el('div', { class: 'grid3' }, field(t('smb.share'), name), field(t('smb.path'), path, t('wsh.hint')), field(t('smb.comment'), remark)),
    field(t('wsh.permission'), access),
    el('div', { class: 'actions' }, button(t('smb.add'), add)),
  ];
}

export function winSharePanel(host: Host, app: AfterChange): LivePanel {
  // Outside the redraw: publishing redraws the panel (notifyChange) before its error is shown.
  const msg = message();
  return liveHostPanel(host, () => [
    el('p', { class: 'muted' }, t('wsh.intro')),
    msg.el,
    el('section', { class: 'subsection' },
      el('h3', {}, t('smb.shares')),
      table<WinShare>(winShares(host), [
        { label: t('smb.share'), value: (s) => s.name, mono: true },
        { label: t('smb.path'), value: (s) => s.path, mono: true },
        { label: t('smb.comment'), value: (s) => s.remark },
        { label: t('wsh.permission'), value: (s) => accessLabel(s.access) },
      ], { empty: t('smb.noShares'), onDelete: (s) => { unpublishWinShare(host, s.name); msg.clear(); app.afterCommand(); } }),
      ...addForm(host, app, msg)),
  ]);
}
