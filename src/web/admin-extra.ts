/**
 * The pages of the management GUI that mirror the rest of the device's window: Parámetros del kernel (Seguridad),
 * mDNS, winbind and the Windows SMB shares (Servicios) and the apt catalogue of its Configuración tab (Administración).
 * Each form does what the matching panel or box does (shells/link-services.ts, kernel-save.ts, apt-install.ts,
 * services/smb-windows.ts); share names and remarks are the user's and reach the page only through `h` (escaped).
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, cards, check, choose, form, row, section, text } from './admin-layout.ts';
import { table } from './admin-pages.ts';
import type { Fields, Outcome } from './admin-actions.ts';
import { SYSCTL_KEYS } from '../net/sysctl.ts';
import { saveSysctl } from '../shells/kernel-save.ts';
import { hasPackage } from '../net/host-packages.ts';
import { avahiSettings, setAvahiSettings, setUnitRunning, setWinsLookup, unitOn, winsLookupOn } from '../shells/link-services.ts';
import { listedPackages } from '../shells/apt-offer.ts';
import type { ListedPackage } from '../shells/apt-offer.ts';
import { setAptInstalled } from '../shells/apt-install.ts';
import { setWinShareOn, winShareOn, winShares } from '../net/win-shares.ts';
import { PUBLISH_ERRORS, publishWinShare, unpublishWinShare } from '../services/smb-windows.ts';

const on = (f: Fields, k: string): boolean => f.get(k) === '1';
const saved = (): Outcome => ({ ok: t('wa.saved') });

/** A one-button form on a row of a table (what it acts on, hidden). */
function rowButton(base: string, page: string, action: string, fields: Readonly<Record<string, string>>, label: string): Markup {
  return form(base, page, action, Object.entries(fields).map(([name, value]) => h('input', { type: 'hidden', name, value })),
    h('button', { type: 'submit', class: 'web-adm-small' }, label));
}

export function sysctlPage(server: Server, base: string): Child {
  const rows = [...SYSCTL_KEYS].sort((a, b) => Number(b.effect) - Number(a.effect) || a.name.localeCompare(b.name)).map((k) => {
    const current = server.kernel.sysctl.get(k.name) ?? '';
    const control = Array.isArray(k.accepts) ? choose('value', current, k.accepts.map((v) => [v, v])) : text('value', current);
    return [h('span', { class: 'web-adm-mono' }, k.name), k.effect ? t('sysctl.yes') : t('sysctl.no'),
      form(base, 'sysctl', 'sysctl', h('input', { type: 'hidden', name: 'key', value: k.name }), control, h('button', { type: 'submit', class: 'web-adm-small' }, t('sysctl.apply')))];
  });
  return cards(section(t('sysctl.tab'), t('sysctl.intro'), table([t('sysctl.key'), t('sysctl.effect'), t('sysctl.value')], rows, '')));
}

export function mdnsPage(server: Server, base: string): Child {
  const conf = avahiSettings(server);
  return form(base, 'mdns', 'mdns', cards(
    section(t('mdns.tab'), t('mdns.intro'), check('enabled', unitOn(server, 'avahi-daemon'), t('mdns.service'))),
    section(t('mdns.name'), t('mdns.hint'), row(t('mdns.name'), text('hostName', conf.hostName, { placeholder: server.runtimeName() })),
      check('publish', conf.publish, t('mdns.publish')))), buttons());
}

export function winbindPage(server: Server, base: string): Child {
  const nss = hasPackage(server, 'libnss-winbind');
  return form(base, 'winbind', 'winbind', cards(section(t('wbd.tab'), t('wbd.intro'),
    check('enabled', unitOn(server, 'winbind'), t('wbd.service')),
    check('wins', winsLookupOn(server), t('wbd.wins'), !nss),
    h('p', { class: 'web-adm-muted' }, nss ? t('wbd.winsHint') : t('wbd.noNss')))), buttons());
}

export function winSharePage(server: Server, base: string): Child {
  const rows = winShares(server).map((s) => [h('span', { class: 'web-adm-mono' }, s.name), h('span', { class: 'web-adm-mono' }, s.path), s.remark,
    t(s.access === 'full' ? 'wsh.full' : 'wsh.read'), rowButton(base, 'winshare', 'wsh-del', { name: s.name }, t('wa.remove'))]);
  return [
    form(base, 'winshare', 'wsh-service', cards(section(t('dev.winshare'), t('wsh.intro'), check('enabled', winShareOn(server), t('wa.enabled')))), buttons()),
    cards(section(t('smb.shares'), '', table([t('smb.share'), t('smb.path'), t('smb.comment'), t('wsh.permission'), ''], rows, t('smb.noShares')))),
    form(base, 'winshare', 'wsh-add', cards(section(t('smb.addShare'), t('wsh.hint'),
      row(t('smb.share'), text('name', '', { placeholder: 'docs' })), row(t('smb.path'), text('path', '', { placeholder: 'C:\\home\\alumno\\docs' })),
      row(t('smb.comment'), text('remark', '')), row(t('wsh.permission'), choose('access', 'read', [['read', t('wsh.read')], ['full', t('wsh.full')]])))), buttons(t('smb.add'))),
  ];
}

function packageRows(base: string, list: readonly ListedPackage[]): Child[][] {
  return list.map((p) => [h('span', { class: 'web-adm-mono' }, p.name), p.installed ? t('wa.pkgInstalled') : t('wa.pkgAbsent'),
    rowButton(base, 'packages', 'pkg', { name: p.name, on: p.installed ? '0' : '1' }, p.installed ? t('wa.pkgRemove') : t('wa.pkgInstall'))]);
}

export function packagesPage(server: Server, base: string): Child {
  const list = listedPackages(server);
  const head = [t('wa.pkgName'), t('wa.state'), ''];
  return cards(
    section(t('dev.svcPackages'), t('wa.pkgHelp'), table(head, packageRows(base, list.filter((p) => p.service)), t('wa.empty'))),
    section(t('dev.packages'), '', table(head, packageRows(base, list.filter((p) => !p.service)), t('wa.empty'))));
}

function shareAction(server: Server, f: Fields, action: string): Outcome {
  if (action === 'wsh-service') { setWinShareOn(server, on(f, 'enabled')); return saved(); }
  if (action === 'wsh-del') return unpublishWinShare(server, f.get('name') ?? '') ? saved() : { error: t('wa.noShare') };
  const err = publishWinShare(server, { name: (f.get('name') ?? '').trim(), path: (f.get('path') ?? '').trim(), remark: f.get('remark') ?? '', access: f.get('access') === 'full' ? 'full' : 'read' });
  return err ? { error: t(PUBLISH_ERRORS[err]) } : saved();
}

/** The forms of these pages; null for an action of another page. */
export function extraAction(server: Server, pageId: string, f: Fields): Outcome | null {
  const action = f.get('action') ?? '';
  if (pageId === 'sysctl' && action === 'sysctl') {
    const value = (f.get('value') ?? '').trim();
    // One line of 99-netfix.conf: a value with a line break would add lines of its own.
    if (/[\r\n]/.test(value)) return { error: t('wa.badValue') };
    const err = saveSysctl(server, f.get('key') ?? '', value);
    return err ? { error: err } : saved();
  }
  if (pageId === 'mdns' && action === 'mdns') {
    if (!setAvahiSettings(server, { hostName: f.get('hostName') ?? '', publish: on(f, 'publish') })) return { error: t('mdns.badName') };
    setUnitRunning(server, 'avahi-daemon', on(f, 'enabled'));
    return saved();
  }
  if (pageId === 'winbind' && action === 'winbind') {
    setUnitRunning(server, 'winbind', on(f, 'enabled'));
    if (hasPackage(server, 'libnss-winbind')) setWinsLookup(server, on(f, 'wins'));
    return saved();
  }
  if (pageId === 'winshare' && action.startsWith('wsh-')) return shareAction(server, f, action);
  if (pageId === 'packages' && action === 'pkg') {
    const name = f.get('name') ?? '';
    // Only what the page lists: the device's catalogue that its lab keeps (or that it has installed).
    if (!listedPackages(server).some((p) => p.name === name)) return { error: t('wa.unknownAction') };
    setAptInstalled(server, name, on(f, 'on'));
    return saved();
  }
  return null;
}
