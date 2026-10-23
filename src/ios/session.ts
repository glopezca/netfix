/** A console session on an IOS device: modes, prompts, dispatch, help and errors. */
import { applyFilter, pipeHelp, splitPipe, withPipeEntry } from './pipe.ts';
import { buildTrie, matchLine, helpFor, completeToken, tokenize } from './parser.ts';
import type { TrieNode, MatchResult } from './parser.ts';
import type { Cli, IosDevice, ModeName, SessionApi } from './device.ts';
import { HELP } from './help.ts';
import { secretHash } from '../core/hash.ts';

const PROMPT_SUFFIX: Readonly<Record<ModeName, string>> = {
  user: '>',
  exec: '#',
  config: '(config)#',
  'config-if': '(config-if)#',
  'config-subif': '(config-subif)#',
  'config-if-range': '(config-if-range)#',
  'dhcp-config': '(dhcp-config)#',
  'dhcp-class': '(config-dhcp-pool-class)#',
  'config-line': '(config-line)#',
  'config-vlan': '(config-vlan)#',
  'config-std-nacl': '(config-std-nacl)#',
  'config-ext-nacl': '(config-ext-nacl)#',
  'config-isakmp': '(config-isakmp)#',
  'config-crypto-map': '(config-crypto-map)#',
  'cfg-crypto-trans': '(cfg-crypto-trans)#',
};

const EXEC_MODES: ReadonlySet<ModeName> = new Set(['user', 'exec']);
const MAX_PASSWORD_TRIES = 3;
const MAX_HISTORY = 50;

interface Tries<D extends IosDevice> {
  readonly normal: TrieNode<Cli<D>>;
  readonly no: TrieNode<Cli<D>>;
}

const trieCache = new WeakMap<object, Tries<IosDevice>>();

type InputState = { kind: 'normal' } | { kind: 'dialog' } | { kind: 'password'; tries: number; onOk: () => void };

export class Session<D extends IosDevice = IosDevice> implements SessionApi {
  readonly device: D;
  mode: ModeName = 'user';
  ifaces: readonly string[] = [];
  pool: string | undefined;
  poolClass: string | undefined;
  vlan: number | undefined;
  acl: string | undefined;
  /** Sub-mode being edited: ISAKMP policy, crypto map entry ("MAP seq") or transform set. */
  crypto: string | undefined;
  private state: InputState = { kind: 'normal' };
  private output: string[] = [];

  constructor(device: D, opts: { initialDialog?: boolean } = {}) {
    this.device = device;
    if (opts.initialDialog) this.state = { kind: 'dialog' };
  }

  banner(): string[] {
    if (this.state.kind !== 'dialog') return [];
    return ['         --- System Configuration Dialog ---', ''];
  }

  prompt(): string {
    if (this.state.kind === 'password') return 'Password: ';
    if (this.state.kind === 'dialog') return 'Continue with configuration dialog? [yes/no]: ';
    return `${this.device.hostname}${PROMPT_SUFFIX[this.mode]}`;
  }

  /** True when the current prompt expects hidden input. */
  isSecretInput(): boolean {
    return this.state.kind === 'password';
  }

  enterMode(mode: ModeName): void {
    this.mode = mode;
  }

  requestPassword(onOk: () => void): void {
    this.state = { kind: 'password', tries: 0, onOk };
  }

  /** Executes one line and returns the output lines (the echoed command is not included). */
  input(line: string): string[] {
    this.output = [];
    if (this.state.kind === 'dialog') this.handleDialog(line);
    else if (this.state.kind === 'password') this.handlePassword(line);
    else this.dispatch(line);
    return this.output;
  }

  help(lineBeforeQuestion: string): string[] {
    const first = tokenize(lineBeforeQuestion)[0]?.text.toLowerCase() ?? '';
    const isShow = EXEC_MODES.has(this.mode) && first.length >= 2 && 'show'.startsWith(first);
    const bar = lineBeforeQuestion.indexOf('|');
    if (isShow && bar >= 0) return pipeHelp(lineBeforeQuestion.slice(bar + 1));
    const help = this.plainHelp(lineBeforeQuestion);
    return isShow ? withPipeEntry(help) : help;
  }

  private plainHelp(lineBeforeQuestion: string): string[] {
    const tries = this.tries(this.mode);
    const isNo = /^\s*no\s+/i.test(lineBeforeQuestion) && !EXEC_MODES.has(this.mode);
    const rest = isNo ? lineBeforeQuestion.replace(/^\s*no\s+/i, '') : lineBeforeQuestion;
    return helpFor(isNo ? tries.no : tries.normal, rest);
  }

  complete(line: string): string | null {
    const tries = this.tries(this.mode);
    const m = /^(\s*no\s+)(.*)$/i.exec(line);
    if (m && !EXEC_MODES.has(this.mode)) {
      const done = completeToken(tries.no, m[2] ?? '');
      return done === null ? null : `${m[1]}${done}`;
    }
    return completeToken(tries.normal, line);
  }

  /** Ctrl+Z */
  ctrlZ(): string[] {
    this.output = [];
    if (!EXEC_MODES.has(this.mode)) this.endConfig();
    return this.output;
  }

  // ------------------------------------------------------------ internals

  private out(...lines: string[]): void {
    this.output.push(...lines);
  }

  private cli(): Cli<D> {
    return { device: this.device, session: this, out: (...l: string[]) => this.out(...l) };
  }

  private tries(mode: ModeName): Tries<D> {
    const defs = this.device.modeTable()[mode] ?? [];
    let cached = trieCache.get(defs);
    if (!cached) {
      cached = { normal: buildTrie(defs, HELP), no: buildTrie(defs, HELP, true) } as Tries<IosDevice>;
      trieCache.set(defs, cached);
    }
    return cached as unknown as Tries<D>;
  }

  endConfig(): void {
    this.mode = 'exec';
    this.ifaces = [];
    this.pool = undefined;
    this.poolClass = undefined;
    this.acl = undefined;
    this.crypto = undefined;
    this.vlan = undefined;
    this.device.log('%SYS-5-CONFIG_I: Configured from console by console');
  }

  private dispatch(line: string): void {
    if (line.trim() === '' || line.trim().startsWith('!')) return;
    this.remember(line);
    if (EXEC_MODES.has(this.mode) && this.piped(line, 0, (cmd) => this.dispatchCommand(cmd))) return;
    this.dispatchCommand(line);
  }

  /**
   * `show … | include|exclude|begin|section <regex>`. Returns false when the line is not a
   * piped `show`, so the normal parser reports the error where IOS would.
   */
  private piped(line: string, base: number, run: (command: string) => void): boolean {
    const split = splitPipe(line);
    const first = tokenize(line)[0]?.text.toLowerCase() ?? '';
    if (!split || first.length < 2 || !'show'.startsWith(first)) return false;
    if (!split.filter) {
      this.out(`${' '.repeat(this.prompt().length + base + split.offset)}^`, "% Invalid input detected at '^' marker.", '');
      return true;
    }
    if (!split.regex) {
      this.out('% Incomplete command.', '');
      return true;
    }
    const outer = this.output;
    this.output = [];
    let lines: string[];
    try {
      run(split.command);
    } finally {
      lines = this.output;
      this.output = outer;
    }
    this.out(...(lines.some((l) => l.startsWith('% ')) ? lines : applyFilter(lines, split.filter, split.regex)));
    return true;
  }

  private dispatchCommand(line: string): void {
    const isNo = !EXEC_MODES.has(this.mode) && /^\s*(no|default)\s/i.test(line);
    const body = isNo ? line.replace(/^\s*(no|default)\s+/i, '') : line;
    const offset = line.length - body.length;
    const result = this.match(this.mode, body, isNo);
    if (result.kind === 'ok') {
      this.execute(result, isNo);
      return;
    }
    if (this.tryParentMode(body, isNo)) return;
    this.reportError(result, line, offset);
  }

  private match(mode: ModeName, body: string, isNo: boolean): MatchResult<Cli<D>> {
    const tries = this.tries(mode);
    return matchLine(isNo ? tries.no : tries.normal, body, false);
  }

  private execute(result: Extract<MatchResult<Cli<D>>, { kind: 'ok' }>, isNo: boolean): void {
    const handler = isNo ? result.def.noRun : result.def.run;
    handler?.(this.cli(), result.match);
  }

  /** Config sub-modes fall back to global configuration commands, like IOS does. */
  private tryParentMode(body: string, isNo: boolean): boolean {
    if (EXEC_MODES.has(this.mode) || this.mode === 'config') return false;
    const parent: ModeName = this.mode === 'dhcp-class' ? 'dhcp-config' : 'config';
    const candidates: ModeName[] = parent === 'dhcp-config' ? ['dhcp-config', 'config'] : ['config'];
    for (const mode of candidates) {
      const result = this.match(mode, body, isNo);
      if (result.kind !== 'ok') continue;
      this.mode = mode;
      if (mode === 'config') this.ifaces = [];
      this.execute(result, isNo);
      return true;
    }
    return false;
  }

  private reportError(result: MatchResult<Cli<D>>, line: string, offset: number): void {
    if (result.kind === 'ambiguous') {
      this.out(`% Ambiguous command:  "${line.trim()}"`);
      return;
    }
    if (result.kind === 'incomplete') {
      this.out('% Incomplete command.', '');
      return;
    }
    if (result.kind !== 'invalid') return;
    const firstWord = tokenize(line)[0]?.text ?? '';
    if (EXEC_MODES.has(this.mode) && result.position + offset === tokenize(line)[0]?.start) {
      this.unknownExecCommand(firstWord, line);
      return;
    }
    const caret = ' '.repeat(this.prompt().length + offset + result.position);
    this.out(`${caret}^`, "% Invalid input detected at '^' marker.", '');
  }

  private unknownExecCommand(word: string, line: string): void {
    if (tokenize(line).length > 1) {
      const caret = ' '.repeat(this.prompt().length + (tokenize(line)[0]?.start ?? 0));
      this.out(`${caret}^`, "% Invalid input detected at '^' marker.", '');
      return;
    }
    if (this.device.domainLookup) this.out(`Translating "${word}"...domain server (255.255.255.255)`);
    this.out('% Unknown command or computer name, or unable to find computer address');
  }

  private remember(line: string): void {
    this.device.history.push(line.trim());
    if (this.device.history.length > MAX_HISTORY) this.device.history.shift();
  }

  private handleDialog(line: string): void {
    const answer = line.trim().toLowerCase();
    if (answer.startsWith('y')) {
      this.out('% Configuration dialog is not supported in this simulator. Entering CLI.');
    }
    this.state = { kind: 'normal' };
    this.out('', '', 'Press RETURN to get started!', '');
  }

  private handlePassword(line: string): void {
    if (this.state.kind !== 'password') return;
    const d = this.device;
    const ok = d.enableSecret ? secretHash(line) === d.enableSecret : line === d.enablePassword;
    if (ok) {
      const { onOk } = this.state;
      this.state = { kind: 'normal' };
      onOk();
      return;
    }
    const tries = this.state.tries + 1;
    if (tries >= MAX_PASSWORD_TRIES) {
      this.state = { kind: 'normal' };
      this.out('% Bad secrets', '');
      return;
    }
    this.state = { ...this.state, tries };
  }

  runExec(line: string): void {
    if (this.piped(line, 3, (cmd) => this.runExecCommand(cmd))) return;
    this.runExecCommand(line);
  }

  private runExecCommand(line: string): void {
    const saved = this.mode;
    const result = this.match('exec', line, false);
    if (result.kind === 'ok') {
      this.mode = 'exec';
      this.execute(result, false);
      if (this.mode === 'exec') this.mode = saved;
      return;
    }
    this.reportError(result, `do ${line}`, 3);
  }
}

/** Replays configuration text (running-config format) on a device. Returns error lines. */
export function applyConfig(device: IosDevice, lines: readonly string[]): string[] {
  const session = new Session(device);
  session.mode = 'config';
  const errors: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // On a workspace the hostname comes from the device name: a saved file, a lab or a pasted configuration keeps it.
    if (shouldSkipConfigLine(line) || (device.lockedHostname() !== null && /^hostname\s/.test(line))) continue;
    if (!line.startsWith(' ') && session.mode !== 'config') session.mode = 'config';
    const out = session.input(line);
    // In a saved configuration an interface without "shutdown" is enabled.
    if (/^interface /.test(line)) session.ifaces.forEach((n) => device.updateIface(n, (c) => ({ ...c, shutdown: false })));
    if (out.some((l) => l.startsWith('%'))) errors.push(`${line.trim()}: ${out.filter((l) => l.startsWith('%')).join(' ')}`);
  }
  return errors;
}

const SKIP_RE = /^(!|end$|version |Building configuration|Current configuration|no service timestamps|service timestamps|no service password-encryption|ip cef|no ipv6 cef|ip classless|ip flow-export|spanning-tree mode|\s*$)/;

function shouldSkipConfigLine(line: string): boolean {
  return SKIP_RE.test(line);
}
