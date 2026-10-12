/** a2ensite, a2dissite, a2enmod, a2dismod, a2enconf, a2disconf and apache2ctl/apachectl (Ubuntu). */
import type { CommandFn, Ctx, Gen } from '../../bash/types.ts';
import { errMsg } from '../../bash/coreutils/common.ts';
import { APACHE_ROOT, MODULE_DEPS } from './defaults.ts';
import { loadApacheConfig } from './conf.ts';
import type { ApacheConfig } from './conf.ts';
import { confReader } from './vfs-view.ts';

type Kind = 'site' | 'mod' | 'conf';

const DIRS: Readonly<Record<Kind, [string, string]>> = { site: ['sites-available', 'sites-enabled'], mod: ['mods-available', 'mods-enabled'], conf: ['conf-available', 'conf-enabled'] };
const LABEL: Readonly<Record<Kind, [string, string]>> = { site: ['site', 'Site'], mod: ['module', 'Module'], conf: ['conf', 'Conf'] };
const ACTIVATE = (verb: string): string => `To activate the new configuration, you need to run:\n  systemctl ${verb} apache2\n`;
const VERSION = 'Server version: Apache/2.4.62 (Ubuntu)\nServer built:   2026-08-12T15:21:04\n';

/** Files of a kind ("x.conf", or "x.load" + optional "x.conf" for modules). */
function filesOf(kind: Kind, name: string): string[] {
  return kind === 'mod' ? [`${name}.load`, `${name}.conf`] : [`${name}.conf`];
}

function available(ctx: Ctx, kind: Kind): string[] {
  const dir = `${APACHE_ROOT}/${DIRS[kind][0]}`;
  try {
    return ctx.sh.env.fs.readdir(dir).filter((n) => n.endsWith(kind === 'mod' ? '.load' : '.conf')).map((n) => n.replace(/\.(conf|load)$/, '')).sort();
  } catch {
    return [];
  }
}

function isEnabled(ctx: Ctx, kind: Kind, name: string): boolean {
  return ctx.sh.env.fs.tryLookup(`${APACHE_ROOT}/${DIRS[kind][1]}/${filesOf(kind, name)[0]}`, undefined, false) !== undefined;
}

function enableOne(ctx: Ctx, kind: Kind, name: string, out: string[]): boolean {
  const [avail, enabled] = DIRS[kind];
  const [low, cap] = LABEL[kind];
  if (!available(ctx, kind).includes(name)) { out.push(`ERROR: ${cap} ${name} does not exist!`); return false; }
  if (isEnabled(ctx, kind, name)) { out.push(`${cap} ${name} already enabled`); return true; }
  if (kind === 'mod') {
    for (const dep of MODULE_DEPS[name] ?? []) {
      out.push(`Considering dependency ${dep} for ${name}:`);
      if (!enableOne(ctx, kind, dep, out)) return false;
    }
  }
  for (const file of filesOf(kind, name)) {
    if (!ctx.sh.env.fs.exists(`${APACHE_ROOT}/${avail}/${file}`)) continue;
    try {
      ctx.sh.env.fs.symlink(`../${avail}/${file}`, `${APACHE_ROOT}/${enabled}/${file}`, ctx.cred);
    } catch (e) {
      out.push(`ERROR: Could not create ${APACHE_ROOT}/${enabled}/${file}: ${errMsg(e)}`);
      return false;
    }
  }
  out.push(`Enabling ${low} ${name}.`);
  return true;
}

function disableOne(ctx: Ctx, kind: Kind, name: string, out: string[]): boolean {
  const [, cap] = LABEL[kind];
  if (!available(ctx, kind).includes(name) && !isEnabled(ctx, kind, name)) { out.push(`ERROR: ${cap} ${name} does not exist!`); return false; }
  if (!isEnabled(ctx, kind, name)) { out.push(`${cap} ${name} already disabled`); return true; }
  for (const file of filesOf(kind, name)) {
    const path = `${APACHE_ROOT}/${DIRS[kind][1]}/${file}`;
    if (ctx.sh.env.fs.tryLookup(path, undefined, false) === undefined) continue;
    try {
      ctx.sh.env.fs.remove(path, ctx.cred);
    } catch (e) {
      out.push(`ERROR: Could not remove ${path}: ${errMsg(e)}`);
      return false;
    }
  }
  out.push(`${cap} ${name} disabled.`);
  return true;
}

function a2(kind: Kind, enable: boolean): CommandFn {
  return function* toggle(ctx: Ctx): Gen<number> {
    let names = ctx.argv.slice(1).filter((a) => !a.startsWith('-')).map((a) => a.replace(/\.(conf|load)$/, ''));
    if (!names.length) {
      const choices = available(ctx, kind).filter((n) => isEnabled(ctx, kind, n) !== enable);
      ctx.out(`Your choices are: ${choices.join(' ')}\nWhich ${LABEL[kind][0]}(s) do you want to ${enable ? 'enable' : 'disable'} (wildcards ok)?\n`);
      const line = yield* ctx.readLine();
      names = (line?.text ?? '').split(/\s+/).filter(Boolean);
    }
    const out: string[] = [];
    let ok = true;
    let changed = false;
    for (const n of names) {
      const was = isEnabled(ctx, kind, n);
      ok = (enable ? enableOne(ctx, kind, n, out) : disableOne(ctx, kind, n, out)) && ok;
      changed = changed || was !== isEnabled(ctx, kind, n);
    }
    if (kind === 'mod' && enable && names.includes('ssl') && changed) out.push('See /usr/share/doc/apache2/README.Debian.gz on how to configure SSL and create self-signed certificates.');
    ctx.out(`${out.join('\n')}${out.length ? '\n' : ''}${changed ? ACTIVATE(kind === 'mod' ? 'restart' : 'reload') : ''}`);
    return ok ? 0 : 1;
  };
}

function vhostDump(cfg: ApacheConfig): string {
  const lines = ['VirtualHost configuration:'];
  const ports = [...new Set(cfg.vhosts.map((v) => v.port))].sort((a, b) => a - b);
  for (const port of ports) {
    const list = cfg.vhosts.filter((v) => v.port === port);
    const name = (v: ApacheConfig['vhosts'][number]): string => `${v.serverName ?? '127.0.1.1'} (${v.file}:${v.line})`;
    if (list.length === 1 && list[0]) lines.push(`*:${port}`.padEnd(23) + name(list[0]));
    else {
      lines.push(`*:${port}`.padEnd(23) + 'is a NameVirtualHost');
      if (list[0]) lines.push(`         default server ${name(list[0])}`);
      for (const v of list) {
        lines.push(`         port ${port} namevhost ${name(v)}`);
        for (const a of v.serverAliases) lines.push(`                 alias ${a}`);
      }
    }
  }
  lines.push('ServerRoot: "/etc/apache2"', `Main DocumentRoot: "${cfg.main.documentRoot ?? '/var/www/html'}"`, 'Main ErrorLog: "/var/log/apache2/error.log"',
    'Mutex default: dir="/var/run/apache2/" mechanism=default ', 'PidFile: "/var/run/apache2/apache2.pid"', 'Define: DUMP_VHOSTS', 'Define: DUMP_RUN_CFG',
    'User: name="www-data" id=33', 'Group: name="www-data" id=33');
  return `${lines.join('\n')}\n`;
}

function moduleDump(cfg: ApacheConfig): string {
  const statics = new Set(['core', 'so', 'watchdog', 'http', 'log_config', 'logio', 'version', 'unixd']);
  const names = [...cfg.modules].filter((m) => m !== 'mpm');
  return `Loaded Modules:\n${names.map((m) => ` ${m}_module (${statics.has(m) ? 'static' : 'shared'})`).join('\n')}\n`;
}

function* apachectl(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const verb = args[0] ?? '';
  const service: Readonly<Record<string, string>> = { start: 'start', stop: 'stop', restart: 'restart', graceful: 'reload', 'graceful-stop': 'stop', status: 'status' };
  if (service[verb]) return yield* ctx.sh.invoke(['systemctl', service[verb] ?? 'status', 'apache2'], ctx.fds);
  if (verb === '-v') { ctx.out(VERSION); return 0; }
  if (verb === '-V') { ctx.out(`${VERSION}Server's Module Magic Number: 20120211:131\nArchitecture:   64-bit\nServer MPM:     event\n -D HTTPD_ROOT="/etc/apache2"\n -D SERVER_CONFIG_FILE="apache2.conf"\n`); return 0; }
  const wants = (flag: string): boolean => args.includes(flag) || args.join(' ').includes(`-D ${flag === '-S' ? 'DUMP_VHOSTS' : 'DUMP_MODULES'}`);
  if (!['configtest', '-t', '-S', '-M'].includes(verb) && !wants('-S') && !wants('-M')) {
    ctx.err(`Usage: /usr/sbin/apache2ctl start|stop|restart|graceful|graceful-stop|configtest|status|fullstatus|help\n       /usr/sbin/apache2ctl <apache2 args>\n       /usr/sbin/apache2 -h for help on <apache2 args>\n`);
    return 1;
  }
  const r = loadApacheConfig(confReader(ctx.sh.env.fs));
  if (!r.ok) {
    ctx.err(`${r.error}\nAction '${verb === '-t' ? '-t' : 'configtest'}' failed.\nThe Apache error log may have more information.\n`);
    return 1;
  }
  for (const w of r.config.warnings) ctx.err(`${w}\n`);
  if (wants('-S')) ctx.out(vhostDump(r.config));
  else if (wants('-M')) ctx.out(moduleDump(r.config));
  else ctx.err('Syntax OK\n');
  return 0;
}

export const APACHE_TOOLS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['a2ensite', a2('site', true)], ['a2dissite', a2('site', false)], ['a2enmod', a2('mod', true)], ['a2dismod', a2('mod', false)],
  ['a2enconf', a2('conf', true)], ['a2disconf', a2('conf', false)], ['apache2ctl', apachectl], ['apachectl', apachectl],
]);
