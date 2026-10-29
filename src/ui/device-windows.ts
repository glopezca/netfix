/** Window contents: IOS CLI for routers/switches; desktop tabs for PCs and Server. */
import { iosDeviceSettings } from './ios-device-settings.ts';
import { iosInterfaces } from './ios-interfaces.ts';
import { hostInterfaces } from './host-interfaces.ts';
import { t } from '../i18n/t.ts';
import { LinuxRouter } from '../devices/linux-router.ts';
import { routerInterfaces } from './router-ip.ts';
import { el } from './dom.ts';
import { Terminal } from './terminal.ts';
import type { ConsoleBackend } from './terminal.ts';
import type { WindowManager } from './windows.ts';
import { Session } from '../ios/session.ts';
import type { IosDevice } from '../ios/device.ts';
import { Host } from '../devices/host.ts';
import type { HostOs } from '../devices/host.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';
import type { Placed, DeviceKind } from '../net/topology.ts';
import { createShell } from '../shells/factory.ts';
import type { Tab } from './windows.ts';
import { hostIpConfig } from './host-ip.ts';
import { hostSettings } from './host-settings.ts';
import { servicesTab } from './server-apps.ts';
import { browserApp, mailApp } from './pc-apps.ts';
import { sshApp } from './ssh-app.ts';
import { sftpApp } from './sftp-app.ts';
import { iosWebSettings } from './ios-web-settings.ts';
import { Cloud } from '../devices/cloud.ts';
import { cloudTabs } from './cloud-window.ts';
import { cloudSettings } from './cloud-device.ts';
import { promptToggle } from './prompt-toggle.ts';
import { featureOn } from '../net/lab-features.ts';
import type { FeatureId } from '../net/lab-features.ts';
import type { PromptToggle } from './prompt-toggle.ts';

export interface WindowHost {
  readonly windows: WindowManager;
  afterCommand(): void;
  peerLabel?(device: string, port: string): string | undefined;
  /** Classroom restrictions: whether a tab of a device kind is shown (all are, when absent). */
  allowsTab?(kind: DeviceKind, tab: string): boolean;
  /** Classroom lock of the timestamp prompt: true/false forces it; undefined lets each device decide. */
  promptLock?(): boolean | undefined;
  /** Configuración → Laboratorio actual: whether a setting of a device kind is on (the defaults, when absent). */
  feature?(kind: DeviceKind, id: FeatureId): boolean;
}

function allowed(host: WindowHost, kind: DeviceKind, tabs: readonly Tab[]): Tab[] {
  return tabs.filter((tab) => host.allowsTab?.(kind, tab.id) ?? true);
}

const on = (host: WindowHost, kind: DeviceKind, id: FeatureId): boolean => host.feature?.(kind, id) ?? featureOn({}, kind, id);

const terminals = new Map<string, Terminal>();
const footers = new Map<string, PromptToggle>();

function iosBackend(device: IosDevice, session: Session): ConsoleBackend {
  return {
    prompt: () => session.prompt(),
    run: (l) => session.input(l),
    help: (l) => session.help(l),
    complete: (l) => session.complete(l),
    ctrlZ: () => session.ctrlZ(),
    secret: () => session.isSecretInput(),
    onAsync: (cb) => device.onConsole(cb),
  };
}

function iosIntro(device: IosDevice): string[] {
  const image = device.kind === 'router' ? 'C2900-UNIVERSALK9-M' : 'C2960-LANBASEK9-M';
  return [
    `Cisco IOS Software, ${image}, RELEASE SOFTWARE (fc2)`,
    'Copyright (c) 1986-2012 by Cisco Systems, Inc.',
    '',
  ];
}

function cliTerminal(placed: Placed, host: WindowHost): Terminal {
  const device = placed.device as IosDevice;
  let term = terminals.get(placed.device.id);
  if (!term) {
    const session = new Session(device, { initialDialog: device.kind === 'router' });
    const intro = [...iosIntro(device), ...session.banner()];
    if (device.kind !== 'router') intro.push('Press RETURN to get started!', '');
    term = new Terminal(iosBackend(device, session), { intro, label: t('win.console', { name: placed.label }), afterRun: () => host.afterCommand(), iosMessages: true });
    terminals.set(placed.device.id, term);
  }
  return term;
}

export function forgetDevice(id: string): void {
  for (const key of [id, `${id}:linux`, `${id}:windows`]) {
    terminals.get(key)?.dispose();
    terminals.delete(key);
    footers.delete(key);
  }
}

export function forgetAll(): void {
  for (const t of terminals.values()) t.dispose();
  terminals.clear();
  footers.clear();
}

export function openDeviceWindow(placed: Placed, host: WindowHost): void {
  const d = placed.device;
  if (d instanceof Host) {
    openHostWindow(placed, d, host);
    return;
  }
  if (d instanceof Cloud) {
    let handle: { setTitle(t: string): void } | undefined;
    const equipo: Tab = { id: 'host', label: t('win.host'), render: () => cloudSettings(placed, d, { afterCommand: () => host.afterCommand(), retitle: (name) => handle?.setTitle(t('win.cloud', { name })) }) };
    handle = host.windows.show(d.id, t('win.cloud', { name: placed.label }), allowed(host, d.kind, [equipo, ...cloudTabs(d, { afterCommand: () => host.afterCommand(), connected: (port) => host.peerLabel?.(d.id, port) })]));
    return;
  }
  const term = cliTerminal(placed, host);
  let handle: { setTitle(t: string): void } | undefined;
  const device = iosDeviceSettings(placed, d, { afterCommand: () => host.afterCommand(), retitle: (title) => handle?.setTitle(title) });
  const ifaces = iosInterfaces(d, { afterCommand: () => host.afterCommand(), peer: (port) => host.peerLabel?.(d.id, port) });
  handle = host.windows.show(d.id, `${placed.label} · ${d.hostname}`, allowed(host, d.kind, [
    { id: 'host', label: t('win.host'), render: () => device.root, onShow: () => device.refresh() },
    { id: 'ifaces', label: t('win.ifaces'), render: () => ifaces.root, onShow: () => ifaces.refresh() },
    ...(on(host, d.kind, 'cli') ? [{ id: 'cli', label: 'CLI', render: () => term.root, onShow: () => term.focus() }] : []),
    ...(on(host, d.kind, 'web') ? [{ id: 'web', label: t('win.webAdmin'), render: () => iosWebSettings(d, () => host.afterCommand()) }] : []),
  ]));
}

/** Both terminals of a device follow its timestamp-prompt setting (and their footer boxes show it). */
function syncPrompts(h: Host): void {
  for (const os of ['linux', 'windows'] as const) {
    terminals.get(`${h.id}:${os}`)?.syncPrompt();
    footers.get(`${h.id}:${os}`)?.refresh();
  }
}

function shellTerminal(placed: Placed, h: Host, os: HostOs, app: WindowHost): Terminal {
  const key = `${h.id}:${os}`;
  let term = terminals.get(key);
  if (!term) {
    const shell = createShell(h, os);
    const intro = os === 'windows'
      ? [t('win.windowsIntro'), '']
      : [t('win.linuxIntro'), t('win.linuxHelp'), ''];
    const backend: ConsoleBackend = {
      prompt: () => shell.prompt(), run: (l) => shell.run(l), secret: () => shell.secret(),
      complete: (l) => shell.complete?.(l) ?? null, interrupt: () => shell.interrupt?.() ?? [], eof: () => shell.eof?.() ?? [],
      editRequest: () => shell.editRequest?.() ?? null, saveEdit: (p, c) => (shell.saveEdit ? shell.saveEdit(p, c) : t('common.unavailable')),
      closeEdit: () => shell.closeEdit?.() ?? [],
      screenFrame: (w, h) => shell.screenFrame?.(w, h) ?? null, screenKey: (k) => shell.screenKey?.(k) ?? [],
      applyPrompt: () => shell.applyTimestampPrompt?.(),
    };
    const footer = promptToggle(h, app.promptLock?.(), () => { syncPrompts(h); app.afterCommand(); });
    footers.set(key, footer);
    term = new Terminal(backend, {
      intro, label: t(os === 'windows' ? 'win.cmdOf' : 'win.termOf', { name: placed.label }), afterRun: () => app.afterCommand(), footer: footer.root,
    });
    terminals.set(key, term);
  }
  return term;
}

function openHostWindow(placed: Placed, h: Host, app: WindowHost): void {
  const disposers: (() => void)[] = [];
  const terminal = (os: HostOs): Tab => ({
    id: os, label: os === 'windows' ? t('win.cmd') : t('win.linuxTerm'),
    render: () => shellTerminal(placed, h, os, app).root,
    onShow: () => { syncPrompts(h); shellTerminal(placed, h, os, app).focus(); },
  });
  const nicTab: Tab = { id: 'ifaces', label: t('win.ifaces'), render: () => { const v = hostInterfaces(h, app, (port) => app.peerLabel?.(h.id, port)); disposers.push(v.dispose); return v.root; } };
  const ipTab: Tab = { id: 'ip', label: t('win.ip'), render: () => { const v = hostIpConfig(h, app); disposers.push(v.dispose); return v.root; } };
  const order: HostOs[] = h.os === 'linux' ? ['linux', 'windows'] : ['windows', 'linux'];
  const model = h instanceof LinuxRouter ? 'Ubuntu' : h instanceof Server ? 'Server' : 'PC';
  let handle: { setTitle(t: string): void } | undefined;
  const settingsTab: Tab = { id: 'host', label: t('win.host'), render: () => {
    const v = hostSettings(placed, h, { afterCommand: () => app.afterCommand(), retitle: (t) => handle?.setTitle(`${t} · ${model}`) });
    disposers.push(v.dispose);
    return v.root;
  } };
  // «Equipo» and «Interfaces» always; the rest as Configuración → Laboratorio actual says.
  const has = (id: FeatureId): boolean => on(app, h.kind, id);
  const ifTab: Tab = h instanceof LinuxRouter
    ? { id: 'ifaces', label: t('win.ifaces'), render: () => { const v = routerInterfaces(h, app, (port) => app.peerLabel?.(h.id, port)); disposers.push(v.dispose); return v.root; } }
    : nicTab;
  const panels = { services: has('services'), sysctl: has('sysctl'), firewall: has('firewall'), vpn: has('vpn') };
  const svc: Tab[] = h instanceof Server && Object.values(panels).some(Boolean) ? [{ id: 'svc', label: t('win.services'), render: () => servicesTab(h, app, panels) }] : [];
  const apps: Tab[] = h instanceof Pc && has('apps') ? [{ id: 'web', label: t('win.browser'), render: () => browserApp(h, app) }, { id: 'mail', label: t('win.mail'), render: () => mailApp(h, app) },
    { id: 'ssh', label: t('ssh.tab'), render: () => sshApp(h, app) }, { id: 'sftp', label: t('sftp.tab'), render: () => sftpApp(h, app) }] : [];
  const tabs: Tab[] = [settingsTab, ifTab, ...(h instanceof LinuxRouter ? svc : [...svc, ...(has('ip') ? [ipTab] : []), ...apps]), ...order.filter(has).map(terminal)];
  handle = app.windows.show(h.id, `${placed.label} · ${model}`, allowed(app, h.kind, tabs), () => disposers.forEach((f) => f()));
}
