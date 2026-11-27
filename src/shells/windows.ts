/**
 * Windows Command Prompt: ipconfig, ping, nslookup, netstat, arp, curl, ssh, sc / net (servers) and the file
 * commands (dir, cd, md, rd, del, copy, move, ren, type, echo, edit, nano, vim) on the device's Windows disk (C:\ is
 * /mnt/c of its file system).
 */
import { nbtstat } from './win-nbt.ts';
import { netUse, netView } from './win-smb.ts';
import { netShare } from './win-net-share.ts';
import type { PasswordQuestion } from './win-smb.ts';
import { smbFileCommand } from './win-smb-files.ts';
import { timestampPromptOn, windowsTimestampPrompt } from './prompt-clock.ts';
import { runsServices } from '../devices/kinds.ts';
import { windowsSshStore } from './ssh-stores.ts';
import type { SshClientStore } from './ssh-client.ts';
import { BaseShell } from './base.ts';
import { resolveHost, httpSteps } from './net-tools.ts';
import { dnsSearch } from './dns-client.ts';
import { startNslookupSteps } from './nslookup.ts';
import type { Nslookup } from './nslookup.ts';
import type { Host } from '../devices/host.ts';
import { HOST_PORT } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { unitActive, openPorts } from '../services/units.ts';
import { netService, sc, serverOf } from './win-services.ts';
import { WinCmd } from './win-cmd.ts';
import { FILTERS, runFilter } from './win-cmd-io.ts';
import { startWinMc } from './win-mc.ts';
import type { McApp } from '../editors/mc.ts';
import type { Frame, KeyInput } from '../editors/buffer.ts';
import { pingSteps } from '../net/ping.ts';
import { pingReport } from './win-ping.ts';
import { HELP } from './win-help.ts';
import { runLive, runSteps, waitFor, waitsLive, type Steps } from '../net/live-wait.ts';
import { tracert } from './trace-cmds.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { hostSystem, hostUsers, defaultLinuxUser } from './host-system.ts';
import { GIT_BIN, WIN_EDITORS, seedWindowsDisk, usersDir, windowsAccount } from './win-system.ts';
import { runWindowsProgram, seedWindowsPrograms, windowsPathFor } from './win-programs.ts';
import { editorProgram } from './programs.ts';
import { WinFiles } from './win-files.ts';
import { WinDrives } from './win-drives.ts';
import { splitCmdLine, toWindowsPath } from './win-path.ts';
import type { EditSpec } from '../bash/types.ts';
import { ipconfig } from './win-ipconfig.ts';

const PING_TIMEOUT_MS = 1000;
const DEFAULT_PING_COUNT = 4;
const MAX_PING_COUNT = 100;
const DHCP_WAIT_MS = 20_000;


/** Internal commands cmd.exe takes glued to a path or switch (cd.., cd\\, dir/w): the name ends at . \\ or /. */
const GLUED = /^(\s*)(cd|chdir|dir|md|mkdir|rd|rmdir|del|erase|type)(?=[.\\/])/i;

const NOT_PERMITTED = ['', 'The operation failed as no adapter is in the state permissible for', 'this operation.', ''];

export class WindowsShell extends BaseShell {
  protected readonly osName = 'Windows';
  private readonly remote: boolean;
  private fileCmds: WinFiles | null = null;
  /** The Linux account behind this terminal is root: PowerShell would run as Administrator (prompt ends in #). */
  private admin = false;
  /** Interactive nslookup (the `>` prompt) until exit or Ctrl+C. */
  private ns: Nslookup | null = null;
  /** net use waiting for a password (typed without echo). */
  private question: PasswordQuestion | null = null;
  private plainLine = false; // the line typed is a plain ping or curl: it may wait live
  /** C: and the drives mapped with net use, each with its own folder. */
  private readonly drives: WinDrives;
  /** cmd.exe's variables, chains and batch files around the commands below. */
  private readonly cmd: WinCmd;
  /** mc.exe while it is open. */
  private screen: McApp | null = null;

  constructor(host: Host, user: string, remote = false) {
    super(host, user);
    this.remote = remote;
    this.drives = new WinDrives(host);
    this.cmd = new WinCmd({
      env: () => this.env(),
      simple: (text, input) => this.simpleLine(text, input),
      prompt: () => this.files().prompt(),
      path: (input) => this.files().winFs.path(input),
      kindOf: (path) => this.files().winFs.kindOf(path),
      read: (path) => { try { return this.files().winFs.fs.readFile(path, this.files().winFs.cred); } catch { return null; } },
      glob: (pattern) => { const l = this.files().winFs.listing(pattern); return typeof l === 'string' ? [] : l.names; },
    });
  }

  /** The file commands, as the Linux account of the device this terminal works as (created on first use). */
  private files(): WinFiles {
    if (this.fileCmds) return this.fileCmds;
    const account = windowsAccount(hostUsers(this.host), this.user, defaultLinuxUser(this.host));
    const cred = { uid: account?.uid ?? 0, gid: account?.gid ?? 0, groups: account?.groups ?? [] };
    this.admin = cred.uid === 0;
    const fs = hostSystem(this.host).fs;
    const srv = serverOf(this.host);
    seedWindowsDisk(fs, this.user, account, srv !== undefined && unitActive(srv.services, 'ssh'));
    seedWindowsPrograms(fs, this.host);
    this.fileCmds = new WinFiles(fs, cred, usersDir(this.user));
    return this.fileCmds;
  }

  protected sshStore(_cwd?: string): SshClientStore {
    return windowsSshStore(this.host, this.user);
  }

  protected localPrompt(): string {
    if (this.ns) return '> ';
    if (this.question) return this.question.prompt;
    if (this.cmd.asking !== null) return this.cmd.asking;
    const files = this.files();
    const drive = files.pending ? null : this.drives.here();
    const here = drive === null ? files.prompt() : `${drive}>`;
    if (timestampPromptOn(this.host) && !files.pending) {
      return windowsTimestampPrompt(this.host.clock.now(), this.user.toLowerCase(), this.host.runtimeName(), here.replace(/>$/, ''), this.admin);
    }
    return this.remote ? `${this.user.toLowerCase()}@${this.host.name.toUpperCase()} ${here}` : here;
  }

  protected notFound(cmd: string): string[] {
    return this.host.kind === 'pc' && !this.remote ? ['Invalid Command.'] : [`'${cmd}' is not recognized as an internal or external command,`, 'operable program or batch file.'];
  }

  /** One cmd.exe line: quoted words, and > or >> sending the output to a file. */
  protected override runLocalLine(line: string): string[] {
    this.plainLine = /^\s*(ping|curl|nslookup|nbtstat|tracert|ipconfig|net)(\s[^|&<>^()]*)?$/i.test(line);
    if (this.ns) {
      const ns = this.ns;
      this.plainLine = true; // a line at nslookup's own `>` prompt
      return this.stepsThen(ns.lineSteps(line), (reply) => {
        if (reply.exit) this.ns = null;
        return reply.out;
      });
    }
    if (this.question) {
      const q = this.question;
      this.question = null;
      this.plainLine = true; // the password asked: connecting may wait live
      return this.stepsThen(q.answer(line), (l) => l);
    }
    if (this.cmd.asking !== null) return this.cmd.answer(line);
    const files = this.files();
    if (files.pending) return files.answer(line);
    return this.cmd.run(line);
  }

  /**
   * One simple cmd.exe command (the line already expanded): quoted words, and > or >> sending the output to a file.
   * find, findstr, sort and more read `input` (a pipe or <) and leave their own errorlevel.
   */
  private simpleLine(line: string, input: readonly string[] | null): { out: string[]; code?: number } {
    const files = this.files();
    const parsed = splitCmdLine(line.trim().replace(GLUED, '$1$2 '));
    if (parsed.error) return { out: ['The syntax of the command is incorrect.'] };
    const [first, ...args] = parsed.words;
    if (!first) return { out: [] };
    // echo. and echo: print what follows (a blank line when nothing does).
    const cmd = /^echo[.:(]/i.test(first) ? 'echo' : first;
    if (cmd.toLowerCase() === 'ssh') return { out: this.startSsh(args) };
    const name = cmd.toLowerCase().replace(/\.exe$/, '');
    const filtered = FILTERS.has(name) ? runFilter(name, parsed.text.trim().replace(/^\S+\s*/, ''), input, (n) => this.cmd.readLines(n)) : null;
    const out = filtered?.out ?? this.runLocal(cmd, args, parsed.text);
    return { out: parsed.redirect ? this.drives.redirect(parsed.redirect, out) ?? files.redirect(parsed.redirect, out) : out, code: filtered?.code };
  }

  protected override localSecret(): boolean {
    return this.question !== null;
  }

  protected override localInterrupt(): string[] {
    this.ns = null;
    this.question = null;
    this.cmd.cancel();
    return [];
  }

  /** The system's variables (set adds its own on top). */
  private env(): Record<string, string> {
    return {
      Path: windowsPathFor(this.host), USERNAME: this.user, USERPROFILE: toWindowsPath(usersDir(this.user)), COMPUTERNAME: this.host.name.toUpperCase(),
      SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', SystemDrive: 'C:',
    };
  }

  /** mc / mc.exe, from Git's usr\bin while it is there: the full-screen file manager on Windows paths. */
  private mc(name: string, args: string[]): string[] | null {
    if (name !== 'mc' && name !== 'mc.exe') return null;
    const w = this.files().winFs;
    if (w.kindOf(`${GIT_BIN}/mc.exe`) !== 'file') return null;
    const editor = editorProgram(this.host, 'windows');
    const edit = editor ? (path: string): string | null =>
      runWindowsProgram(this.host, editor.name, [path], w, this.user, usersDir(this.user)) === null ? `${editor.name}.exe: not found` : null : undefined;
    // mc's command line: cmd.exe runs the line from the panel's folder; the shell keeps its own folder and screen.
    const run = (line: string, dir: string): { lines: string[]; dir: string } => {
      const [cwd, screen] = [w.cwd, this.screen];
      w.cwd = dir;
      try {
        const lines = this.cmd.run(line);
        return { lines, dir: w.cwd };
      } finally {
        w.cwd = cwd;
        this.screen = screen;
      }
    };
    const app = startWinMc(w, args, edit, run, usersDir(this.user));
    if (Array.isArray(app)) return app;
    this.screen = app;
    return [];
  }

  protected override localScreenFrame(width: number, height: number): Frame | null {
    return this.screen?.frame(width, height) ?? null;
  }

  protected override localScreenKey(key: KeyInput): string[] {
    this.screen?.key(key);
    if (this.screen?.closed) this.screen = null;
    return [];
  }

  /** nano / vim (or nano.exe, vim.exe): found through %PATH% in Git's usr\bin while the program is there. */
  private editor(name: string): 'nano' | 'vim' | null {
    const e = WIN_EDITORS.find((x) => name === x || name === `${x}.exe`);
    return e && this.files().winFs.kindOf(`${GIT_BIN}/${e}.exe`) === 'file' ? e : null;
  }

  private nslookup(args: string[]): string[] {
    return this.stepsThen(startNslookupSteps(this.host, true, args), (start) => {
      if (start.interactive) this.ns = start.ns;
      return start.out;
    });
  }

  protected override localEditRequest(): EditSpec | null {
    return this.fileCmds?.editing ?? null;
  }

  protected override localSaveEdit(path: string, content: string): string | null {
    return this.fileCmds ? this.fileCmds.saveEdit(path, content) : 'No editor is open';
  }

  protected override localCloseEdit(): string[] {
    if (this.fileCmds) this.fileCmds.editing = null;
    return [];
  }

  protected runLocal(cmd: string, args: string[], text = ''): string[] {
    const arg = (args[0] ?? '').toLowerCase();
    const name = cmd.toLowerCase();
    if (/^[a-z]:$/.test(name) && !args.length) return this.drives.select(name);
    if (name === 'cd' || name === 'chdir') return this.drives.cd(args, this.files());
    const paths = this.drives.paths(name, args);
    const share = smbFileCommand(this.host, this.files().winFs, name, paths);
    if (share) return this.files().ask(share);
    const editor = this.editor(name);
    if (editor) return this.files().edit(paths, editor);
    const mc = this.mc(name, paths);
    if (mc) return mc;
    const program = runWindowsProgram(this.host, name, args, this.files().winFs, this.user, usersDir(this.user));
    if (program) return program;
    const file = this.files().run(name, paths, text);
    if (file) return file;
    switch (cmd.toLowerCase()) {
      case 'ipconfig': return this.ipconfig(arg);
      case 'ping': return this.ping(args);
      case 'tracert': return this.stepsThen(tracert(this.host, args), (l) => l);
      case 'arp': return this.arp(arg);
      case 'nslookup': return this.nslookup(args);
      case 'netstat': return this.netstat();
      case 'curl': return this.curl(args);
      case 'hostname': return [this.host.name];
      case 'whoami': return [`${this.host.name.toLowerCase()}\\${this.user.toLowerCase()}`];
      case 'ver': return ['', 'Microsoft Windows [Version 10.0.20348.2700]', ''];
      case 'sc': return sc(this.host, args);
      case 'net': return this.netCommand(args);
      case 'nbtstat': return this.stepsThen(nbtstat(this.host, args), (l) => l);
      case 'help': case '?': return HELP;
      case 'cls': return [];
      case 'path': return [`PATH=${windowsPathFor(this.host)}`];
      case 'exit':
        if (this.remote) this.closed = true;
        return [];
      // A batch file sees its arguments as typed: a quoted one keeps its quotes in %1 (%~1 drops them).
      default: return this.cmd.batch(cmd, args.map((x) => (/[\s&()^]/.test(x) ? `"${x}"` : x))) ?? this.notFound(cmd);
    }
  }

  private ipconfig(arg: string): string[] {
    if (arg === '' || arg === '/all') return ipconfig(this.host, arg === '/all');
    if (arg === '/renew') return this.renew();
    if (arg === '/release') return this.release();
    return this.notFound('ipconfig');
  }

  private renew(): string[] {
    const h = this.host;
    if (h.config.mode !== 'dhcp') return NOT_PERMITTED;
    h.dhcpStatus = 'requesting';
    h.dhcpClient.renew();
    // A DHCP server in another page (bridged): its answer is waited for live (0.94.0).
    return this.stepsThen(waitFor(() => h.dhcpClient.state === 'BOUND' || h.dhcpStatus === 'failed', DHCP_WAIT_MS), () => (h.dhcpClient.state !== 'BOUND'
      ? ['', `An error occurred while renewing interface ${HOST_PORT} : unable to contact your DHCP server. Request has timed out.`, ''] : ipconfig(h, false)));
  }

  private release(): string[] {
    const h = this.host;
    if (h.config.mode !== 'dhcp') return NOT_PERMITTED;
    h.dhcpClient.release();
    h.hooks.runUntil(() => false, 10);
    h.config = { mode: 'dhcp' };
    h.dhcpStatus = 'idle';
    return ipconfig(h, false);
  }

  private ping(args: string[]): string[] {
    const nIdx = args.findIndex((w) => w.toLowerCase() === '-n');
    const count = nIdx >= 0 ? Math.min(MAX_PING_COUNT, Math.max(1, Number(args[nIdx + 1]) || DEFAULT_PING_COUNT)) : DEFAULT_PING_COUNT;
    const target = args.filter((_, i) => nIdx < 0 || (i !== nIdx && i !== nIdx + 1)).pop();
    if (!target) return this.notFound('ping');
    const r = resolveHost(this.host, target, 'windows');
    if (r.kind === 'error') return [`Ping request could not find host ${target}. Please check the name and try again.`];
    const ip = formatIp(r.ip);
    // A name (from DNS or the hosts file) shows with its address; an address alone shows bare.
    const header = ['', `Pinging ${parseIp(target) === null ? `${r.name} [${ip}]` : ip} with 32 bytes of data:`, ''];
    return this.stepsThen(pingSteps(this.host.stack, r.ip, { count, timeoutMs: PING_TIMEOUT_MS }), (results) => pingReport(results, ip, count), header);
  }
  /** A client's waits: fast-forwarded in a network all in this page, else live — the header now, the rest when it ends (0.92.0). */
  private stepsThen<T>(steps: Steps<T>, show: (r: T) => string[], header: string[] = []): string[] {
    if (!this.liveWaits || !this.plainLine || !waitsLive(this.host.hooks)) return [...header, ...show(runSteps(this.host.hooks, steps))];
    this.waitFor(runLive(steps).then(show));
    return header;
  }


  private arp(arg: string): string[] {
    if (arg === '-d') {
      this.host.stack.flushArp();
      return [];
    }
    if (arg !== '-a') return this.notFound('arp');
    if (this.host.stack.arp.size === 0) return ['No ARP Entries Found'];
    return ['  Internet Address      Physical Address      Type',
      ...[...this.host.stack.arp].map(([ip, e]) => `  ${formatIp(ip).padEnd(22)}${formatMacCisco(e.mac).padEnd(22)}dynamic`)];
  }

  private netstat(): string[] {
    const local = this.host.config.ip !== undefined ? formatIp(this.host.config.ip) : '0.0.0.0';
    const ports = runsServices(this.host.kind) ? openPorts((this.host as Server).services, { http: (this.host as Server).web.httpPorts(), admin: (this.host as Server).web.adminPorts() }) : [];
    return ['', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State',
      ...ports.map((p) => `  ${p.proto.toUpperCase().padEnd(7)}${`${p.proto === 'udp' ? '0.0.0.0' : local}:${p.port}`.padEnd(23)}${(p.proto === 'udp' ? '*:*' : '0.0.0.0:0').padEnd(23)}${p.proto === 'tcp' ? 'LISTENING' : ''}`)];
  }

  private curl(args: string[]): string[] {
    const head = args.includes('-I');
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) return ["curl: try 'curl --help' for more information"];
    return this.stepsThen(httpSteps(this.host, url, { method: head ? 'HEAD' : 'GET', client: 'windows' }), (r) => {
      if (r.kind === 'error') return [`curl: (${r.code}) ${r.message}`];
      return head ? [`HTTP/1.1 ${r.response.status} ${r.response.reason}`, `Server: ${r.response.server}`, `Content-Type: ${r.response.contentType}`, ''] : r.response.body.split('\n');
    });
  }

  private netCommand(args: string[]): string[] {
    const verb = (args[0] ?? '').toLowerCase();
    if (verb === 'view') return this.stepsThen(netView(this.host, args[1]), (l) => l);
    if (verb === 'share') return netShare(this.host, args.slice(1));
    if (verb !== 'use') return netService(this.host, args);
    return this.stepsThen(netUse(this.host, args.slice(1)), (r) => {
      if (Array.isArray(r)) return r;
      this.question = r;
      return [];
    });
  }

}
