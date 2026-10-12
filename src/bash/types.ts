/** Shared types of the bash interpreter: interactions, file descriptors, command context, signals. */
import type { Cred, Vfs } from './vfs.ts';
import type { Interp } from './interp.ts';

/** What the editor needs to open a file (the UI or an SSH client builds the editor from it). */
export interface EditSpec {
  readonly editor: 'nano' | 'vim';
  /** Absolute path. */
  readonly path: string;
  readonly content: string;
  readonly exists: boolean;
  readonly readOnly: boolean;
  /** Line to place the cursor on (+N). */
  readonly line?: number;
}

/** Execution pauses: the terminal must answer with a line (null = Ctrl+D) or run the editor. */
export type Interaction =
  | { readonly kind: 'line'; readonly prompt: string; readonly secret: boolean }
  /** `save` writes with the editor's credentials and returns an error message or null. */
  | { readonly kind: 'edit'; readonly spec: EditSpec; readonly save: (path: string, content: string) => string | null }
  /** Nested interactive shell (bash, sudo -i, su): resumed with its exit status when it ends. */
  | { readonly kind: 'shell'; readonly user: UserInfo; readonly login: boolean }
  /** ssh client session, handled by the terminal adapter; resumed with its exit status. */
  | { readonly kind: 'ssh'; readonly args: readonly string[] };

export type Gen<T = number> = Generator<Interaction, T, string | null>;

export type Sink =
  | { readonly kind: 'term'; readonly notty?: boolean }
  | { readonly kind: 'buf'; readonly chunks: string[] }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'null' };

export type Source =
  | { readonly kind: 'tty' }
  | { readonly kind: 'data'; readonly data: string; pos: number }
  | { readonly kind: 'null' };

export interface Fd {
  readonly read?: Source;
  readonly write?: Sink;
}

export type Fds = ReadonlyMap<number, Fd>;

export interface LineRead {
  readonly text: string;
  /** The line was not terminated by a newline (end of input). */
  readonly eof: boolean;
}

/** Assignment argument of declare/local/export/readonly/typeset, already expanded. */
export interface DeclArg {
  readonly name: string;
  readonly index?: string;
  readonly append: boolean;
  readonly value?: string;
  readonly array?: readonly { readonly key?: string; readonly value: string }[];
}

export interface Ctx {
  readonly sh: Interp;
  /** Declaration builtins: argv index → assignment. */
  readonly decl?: ReadonlyMap<number, DeclArg>;
  readonly argv: readonly string[];
  readonly fds: Fds;
  readonly env: ReadonlyMap<string, string>;
  readonly cred: Cred;
  readonly cwd: string;
  out(text: string): void;
  err(text: string): void;
  /** Writes `name: msg` to stderr and returns `code`. */
  fail(msg: string, code?: number): number;
  readLine(prompt?: string, secret?: boolean): Gen<LineRead | null>;
  readAll(): Gen<string>;
  /** Absolute path relative to the working directory. */
  resolve(path: string): string;
}

export type CommandFn = (ctx: Ctx) => number | Gen<number>;

export interface UserInfo {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly home: string;
  readonly shell: string;
  readonly groups: readonly number[];
}

/** What the host offers to the shell: identity, file system, users and external programs. */
export interface HostEnv {
  readonly hostname: string;
  readonly fs: Vfs;
  users(): readonly UserInfo[];
  /** Programs found in /usr/bin and /usr/sbin (network tools, systemctl, editors…). */
  readonly commands: ReadonlyMap<string, CommandFn>;
  /** Simulated wall clock (epoch milliseconds). */
  now(): number;
  /** Lets simulated time pass (sleep). */
  wait?(ms: number): void;
  /** Addresses for `hostname -I`. */
  ipAddress?(): string;
  /** Password of an account (SSH users); undefined = no password set (sudo does not ask). */
  password?(user: string): string | undefined;
}

export class ShellSignal extends Error {}

export class ExitSignal extends ShellSignal {
  readonly code: number;
  constructor(code: number) {
    super('exit');
    this.code = code;
  }
}

export class ReturnSignal extends ShellSignal {
  readonly code: number;
  constructor(code: number) {
    super('return');
    this.code = code;
  }
}

export class LoopSignal extends ShellSignal {
  readonly kind: 'break' | 'continue';
  readonly levels: number;
  constructor(kind: 'break' | 'continue', levels: number) {
    super(kind);
    this.kind = kind;
    this.levels = levels;
  }
}

/** Error that discards the rest of the current input line (bash: jump to top level). */
export class DiscardSignal extends ShellSignal {
  readonly code: number;
  constructor(code: number) {
    super('discard');
    this.code = code;
  }
}

/** Ctrl+C or the execution limit: aborts everything that is running. */
export class AbortSignal extends ShellSignal {
  readonly code: number;
  readonly note: string;
  constructor(code: number, note: string) {
    super(note);
    this.code = code;
    this.note = note;
  }
}
