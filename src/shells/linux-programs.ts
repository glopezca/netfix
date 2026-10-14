/** The Netfix programs of an Ubuntu host: network clients, systemd tools, ssh and command-not-found. */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { httpGet } from './net-tools.ts';
import { systemctl, journalctl, ss } from './linux-services.ts';
import { ip, ping, dig, nslookup, hostCmd, dhclient } from './linux-net.ts';
import { traceroute } from './trace-cmds.ts';
import { FsError } from '../bash/vfs.ts';
import { APACHE_TOOLS } from '../services/apache/tools.ts';
import { curl } from './curl.ts';
import { sshKeygen } from './ssh-keygen.ts';
import { sysctl, dmesg } from './kernel-cmds.ts';
import { nft } from './nft-cmd.ts';
import { nc, nmap } from './scan-tools.ts';
import { SSH_USAGE, SSH_WITH_VALUE } from './ssh-client.ts';
import { sshCopyId } from './ssh-copy-id.ts';
import { netplanProgram } from './netplan.ts';
import { rndc } from './rndc.ts';

const PACKAGES: Readonly<Record<string, string>> = {
  ifconfig: 'net-tools', netstat: 'net-tools', route: 'net-tools', arp: 'net-tools', traceroute: 'traceroute', tcpdump: 'tcpdump',
  telnet: 'inetutils-telnet', conntrack: 'conntrack', htop: 'htop', tree: 'tree', zip: 'zip', unzip: 'unzip', php: 'php8.4-cli', python: 'python-is-python3',
  a2ensite: 'apache2', a2dissite: 'apache2', a2enmod: 'apache2', a2dismod: 'apache2', a2enconf: 'apache2', a2disconf: 'apache2', apache2ctl: 'apache2', apachectl: 'apache2',
  emacs: 'emacs-nox', mysql: 'mysql-client-core-8.4', git: 'git', make: 'make', gcc: 'gcc', ftp: 'tnftp', whois: 'whois',
};

const lines = (ctx: Ctx, list: readonly string[]): void => {
  if (list.length) ctx.out(`${list.join('\n')}\n`);
};

/** Messages of systemctl/journalctl that go to stderr with a failure status. */
const FAILURE = /^(Failed to|Unit .* could not be found|Too few arguments|Unknown command verb|Job for)/;

function systemd(host: Host, kind: 'systemctl' | 'service'): CommandFn {
  return (ctx: Ctx): number => {
    const raw = ctx.argv.slice(1);
    if (kind === 'service' && raw.length < 2) {
      ctx.err(raw[0] === '--status-all' ? '' : 'Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]\n');
      return raw[0] === '--status-all' ? 0 : 1;
    }
    const args = kind === 'service' ? [raw[1] ?? '', raw[0] ?? ''] : raw;
    const out = systemctl(host, args, ctx.cred.uid === 0);
    if (out.length && FAILURE.test(out[0] ?? '')) { ctx.err(`${out.join('\n')}\n`); return /could not be found|not found/.test(out[0] ?? '') ? 4 : 1; }
    lines(ctx, out);
    if (args[0] === 'is-active' || args[0] === 'status') return out[0] === 'inactive' || out.some((l) => /Active: inactive/.test(l)) ? 3 : 0;
    return 0;
  };
}

function freeName(ctx: Ctx, name: string): string {
  const fs = ctx.sh.env.fs;
  if (!fs.exists(ctx.resolve(name))) return name;
  for (let i = 1; ; i++) if (!fs.exists(ctx.resolve(`${name}.${i}`))) return `${name}.${i}`;
}

function writeOut(ctx: Ctx, prog: string, file: string, body: string): boolean {
  try {
    ctx.sh.env.fs.writeFile(ctx.resolve(file), body, ctx.cred);
    return true;
  } catch (e) {
    ctx.err(`${prog}: ${file}: ${e instanceof FsError ? e.message : 'Cannot write'}\n`);
    return false;
  }
}

function wget(host: Host): CommandFn {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const quiet = args.includes('-q') || args.includes('--quiet');
    const oIdx = args.findIndex((a) => a === '-O' || a === '--output-document');
    const url = args.find((a, i) => !a.startsWith('-') && !(oIdx >= 0 && i === oIdx + 1));
    if (!url) { ctx.err("wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options.\n"); return 1; }
    const say = (t: string): void => { if (!quiet) ctx.err(t); };
    const stamp = new Date(host.clock.now()).toISOString().slice(0, 19).replace('T', ' ');
    say(`--${stamp}--  ${url}\n`);
    const r = httpGet(host, url);
    if (r.kind === 'error') { say(r.code === 6 ? `wget: unable to resolve host address ‘${url.replace(/^\w+:\/\//, '').split(/[/:]/)[0]}’\n` : `${r.message}.\n`); return 4; }
    const res = r.response;
    say(`Connecting to ${url.replace(/^\w+:\/\//, '').split('/')[0]}... connected.\nHTTP request sent, awaiting response... ${res.status} ${res.reason}\n`);
    if (res.status !== 200) { say(`${stamp} ERROR ${res.status}: ${res.reason}.\n\n`); return 8; }
    const name = oIdx >= 0 ? args[oIdx + 1] ?? 'index.html' : freeName(ctx, url.split('/').filter(Boolean).slice(2).pop() ?? 'index.html');
    say(`Length: ${res.body.length} [${res.contentType.split(';')[0]}]\nSaving to: ‘${name}’\n\n`);
    if (name === '-') { ctx.out(res.body); return 0; }
    if (!writeOut(ctx, 'wget', name, res.body)) return 3;
    say(`‘${name}’ saved [${res.body.length}/${res.body.length}]\n\n`);
    return 0;
  };
}

/** Options before the destination (the remote command's words are not options of ssh). */
function sshOptions(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (!a.startsWith('-') || a === '-') break;
    out.push(a);
    if (a.length === 2 && SSH_WITH_VALUE.has(a)) i++;
  }
  return out;
}

function* ssh(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const opts = sshOptions(args);
  if (opts.includes('-V')) { ctx.err('OpenSSH_10.0p2 Ubuntu-5ubuntu2, OpenSSL 3.5.3 16 Sep 2025\n'); return 0; }
  if (!args.length || opts.includes('-h')) { ctx.err(`${SSH_USAGE}\n`); return 255; }
  const status = yield { kind: 'ssh', args, cwd: ctx.cwd };
  return Number(status ?? 255);
}

function commandNotFound(ctx: Ctx): number {
  const name = ctx.argv.filter((a) => a !== '--')[1] ?? '';
  const pkg = PACKAGES[name];
  if (!pkg) { ctx.err(`${name}: command not found\n`); return 127; }
  ctx.err(`Command '${name}' not found, but can be installed with:\nsudo apt install ${pkg}\n`);
  return 127;
}

export function linuxPrograms(host: Host): Map<string, CommandFn> {
  return new Map<string, CommandFn>([
    ['ip', ip(host)], ['ping', ping(host)], ['traceroute', traceroute(host)], ['dig', dig(host)], ['nslookup', nslookup(host)], ['host', hostCmd(host)], ['dhclient', dhclient(host)], ['netplan', netplanProgram(host)],
    ['curl', curl(host)], ['wget', wget(host)], ['ssh', ssh], ['sysctl', sysctl(host)], ['dmesg', dmesg(host)], ['nft', nft(host)], ['nc', nc(host)], ['netcat', nc(host)], ['nmap', nmap(host)], ['ssh-keygen', sshKeygen], ['ssh-copy-id', sshCopyId],
    ['systemctl', systemd(host, 'systemctl')], ['service', systemd(host, 'service')],
    ['journalctl', (ctx) => { lines(ctx, journalctl(host, ctx.argv.slice(1))); return 0; }],
    ['ss', (ctx) => { lines(ctx, ss(host)); return 0; }],
    ['command-not-found', commandNotFound],
    ...(host.kind === 'server' ? [...APACHE_TOOLS, ['rndc', rndc(host)] as const] : []),
  ]);
}
