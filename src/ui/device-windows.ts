/** Window contents: IOS CLI for routers/switches; desktop tabs for PCs and Server. */
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
import type { Placed } from '../net/topology.ts';
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

export interface WindowHost {
  readonly windows: WindowManager;
  afterCommand(): void;
  peerLabel?(device: string, port: string): string | undefined;
}

const terminals = new Map<string, Terminal>();

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
    term = new Terminal(iosBackend(device, session), { intro, label: `Consola de ${placed.label}`, afterRun: () => host.afterCommand(), iosMessages: true });
    terminals.set(placed.device.id, term);
  }
  return term;
}

export function forgetDevice(id: string): void {
  for (const key of [id, `${id}:linux`, `${id}:windows`]) {
    terminals.get(key)?.dispose();
    terminals.delete(key);
  }
}

export function forgetAll(): void {
  for (const t of terminals.values()) t.dispose();
  terminals.clear();
}

export function openDeviceWindow(placed: Placed, host: WindowHost): void {
  const d = placed.device;
  if (d instanceof Host) {
    openHostWindow(placed, d, host);
    return;
  }
  if (d instanceof Cloud) {
    host.windows.show(d.id, `${placed.label} · Nube ISP`, cloudTabs(d, { afterCommand: () => host.afterCommand(), connected: (port) => host.peerLabel?.(d.id, port) }));
    return;
  }
  const term = cliTerminal(placed, host);
  host.windows.show(d.id, `${placed.label} · ${d.hostname}`, [
    { id: 'cli', label: 'CLI', render: () => term.root, onShow: () => term.focus() },
    { id: 'web', label: 'Gestión web', render: () => iosWebSettings(d, () => host.afterCommand()) },
  ]);
}

function shellTerminal(placed: Placed, h: Host, os: HostOs, app: WindowHost): Terminal {
  const key = `${h.id}:${os}`;
  let term = terminals.get(key);
  if (!term) {
    const shell = createShell(h, os);
    const intro = os === 'windows'
      ? ['Microsoft Windows (Netfix) · escribe help para ver los comandos.', '']
      : ['Ubuntu 26.04 LTS (GNU/Linux 6.17.0-14-generic x86_64) · GNU bash 5.3 en Netfix', 'Ayuda: help, man <orden> o la pestaña Documentación. Editores: nano y vim.', ''];
    const backend: ConsoleBackend = {
      prompt: () => shell.prompt(), run: (l) => shell.run(l), secret: () => shell.secret(),
      complete: (l) => shell.complete?.(l) ?? null, interrupt: () => shell.interrupt?.() ?? [], eof: () => shell.eof?.() ?? [],
      editRequest: () => shell.editRequest?.() ?? null, saveEdit: (p, c) => (shell.saveEdit ? shell.saveEdit(p, c) : 'No disponible'),
      closeEdit: () => shell.closeEdit?.() ?? [],
      screenFrame: (w, h) => shell.screenFrame?.(w, h) ?? null, screenKey: (k) => shell.screenKey?.(k) ?? [],
    };
    term = new Terminal(backend, {
      intro, label: `${os === 'windows' ? 'Símbolo del sistema' : 'Terminal'} de ${placed.label}`, afterRun: () => app.afterCommand(),
    });
    terminals.set(key, term);
  }
  return term;
}

function openHostWindow(placed: Placed, h: Host, app: WindowHost): void {
  const disposers: (() => void)[] = [];
  const terminal = (os: HostOs): Tab => ({
    id: os, label: os === 'windows' ? 'Símbolo del sistema' : 'Terminal Linux',
    render: () => shellTerminal(placed, h, os, app).root, onShow: () => shellTerminal(placed, h, os, app).focus(),
  });
  const ipTab: Tab = { id: 'ip', label: 'Configuración IP', render: () => { const v = hostIpConfig(h, app); disposers.push(v.dispose); return v.root; } };
  const order: HostOs[] = h.os === 'linux' ? ['linux', 'windows'] : ['windows', 'linux'];
  const model = h instanceof LinuxRouter ? '2911 Linux' : h instanceof Server ? 'Server' : 'PC';
  let handle: { setTitle(t: string): void } | undefined;
  const settingsTab: Tab = { id: 'host', label: 'Equipo', render: () => {
    const v = hostSettings(placed, h, { afterCommand: () => app.afterCommand(), retitle: (t) => handle?.setTitle(`${t} · ${model}`) });
    disposers.push(v.dispose);
    return v.root;
  } };
  const routerTabs = (r: LinuxRouter): Tab[] => [
    { id: 'svc', label: 'Servicios', render: () => servicesTab(r, app) },
    { id: 'ifaces', label: t('router.ifaces'), render: () => { const v = routerInterfaces(r, app); disposers.push(v.dispose); return v.root; } },
    settingsTab, terminal('linux'),
  ];
  const tabs: Tab[] = h instanceof LinuxRouter ? routerTabs(h) : h instanceof Server
    ? [{ id: 'svc', label: 'Servicios', render: () => servicesTab(h, app) }, ipTab, settingsTab, ...order.map(terminal)]
    : [ipTab, ...(h instanceof Pc ? [{ id: 'web', label: 'Navegador', render: () => browserApp(h, app) }, { id: 'mail', label: 'Correo', render: () => mailApp(h, app) },
      { id: 'ssh', label: t('ssh.tab'), render: () => sshApp(h, app) }, { id: 'sftp', label: t('sftp.tab'), render: () => sftpApp(h, app) }] : []), settingsTab, ...order.map(terminal)];
  handle = app.windows.show(h.id, `${placed.label} · ${model}`, tabs, () => disposers.forEach((f) => f()));
}
