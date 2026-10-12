/**
 * IOS HTTP server (web management) and local user database:
 * `ip http server`, `ip http port`, `ip http authentication`, `username … privilege … secret|password …`.
 */
import type { CommandDef } from './parser.ts';
import type { Cli, IosDevice } from './device.ts';
import { secretHash } from '../core/hash.ts';

export type HttpAuth = 'enable' | 'local';

export interface IosHttpConfig {
  readonly server: boolean;
  readonly port: number;
  readonly auth: HttpAuth;
}

export interface LocalUser {
  readonly name: string;
  readonly privilege: number;
  /** Type-5 hash (`secret`) … */
  readonly secret?: string;
  /** … or clear text (`password`). */
  readonly password?: string;
}

export const DEFAULT_HTTP_PORT = 80;
export const DEFAULT_HTTP: IosHttpConfig = { server: false, port: DEFAULT_HTTP_PORT, auth: 'enable' };
export const MAX_PRIVILEGE = 15;
const DEFAULT_PRIVILEGE = 1;

type Def = CommandDef<Cli<IosDevice>>;

function setUser(cli: Cli, user: LocalUser): void {
  const d = cli.device;
  d.users = [...d.users.filter((u) => u.name !== user.name), user];
}

function priv(text: string | undefined): number {
  return text === undefined ? DEFAULT_PRIVILEGE : Number(text);
}

const http = (cli: Cli, change: Partial<IosHttpConfig>): void => cli.device.setHttp({ ...cli.device.http, ...change });

export const HTTP_GLOBAL: readonly Def[] = [
  { syntax: 'ip http server', run: (cli) => http(cli, { server: true }), noRun: (cli) => http(cli, { server: false }) },
  { syntax: 'ip http port <1-65535:port>', run: (cli, m) => http(cli, { port: Number(m.get('port')) }), noRun: (cli) => http(cli, { port: DEFAULT_HTTP_PORT }) },
  { syntax: 'ip http authentication {enable | local}', run: (cli, m) => http(cli, { auth: m.has('local') ? 'local' : 'enable' }), noRun: (cli) => http(cli, { auth: 'enable' }) },
  {
    syntax: 'username <WORD:name> [privilege <0-15:p>] secret [0] <WORD:pw>',
    run: (cli, m) => setUser(cli, { name: m.get('name') ?? '', privilege: priv(m.get('p')), secret: secretHash(m.get('pw') ?? '') }),
  },
  {
    syntax: 'username <WORD:name> [privilege <0-15:p>] secret 5 <WORD:hash>',
    run: (cli, m) => setUser(cli, { name: m.get('name') ?? '', privilege: priv(m.get('p')), secret: m.get('hash') ?? '' }),
    hidden: true,
  },
  {
    syntax: 'username <WORD:name> [privilege <0-15:p>] password [0] <WORD:pw>',
    run: (cli, m) => setUser(cli, { name: m.get('name') ?? '', privilege: priv(m.get('p')), password: m.get('pw') ?? '' }),
  },
  {
    syntax: 'username <WORD:name> [<LINE:rest>]',
    run: (cli) => cli.out('% Incomplete command.'),
    noRun: (cli, m) => { cli.device.users = cli.device.users.filter((u) => u.name !== m.get('name')); },
    hidden: true,
  },
];

/** `username …` lines of the running configuration. */
export function userLines(device: IosDevice): string[] {
  const lines = device.users.map((u) => {
    const p = u.privilege !== DEFAULT_PRIVILEGE ? ` privilege ${u.privilege}` : '';
    return u.secret !== undefined ? `username ${u.name}${p} secret 5 ${u.secret}` : `username ${u.name}${p} password 0 ${u.password ?? ''}`;
  });
  return lines.length ? [...lines, '!'] : [];
}

/** `ip http …` lines of the running configuration. */
export function httpLines(device: IosDevice): string[] {
  const h = device.http;
  const lines = h.server ? ['ip http server'] : [];
  if (h.port !== DEFAULT_HTTP_PORT) lines.push(`ip http port ${h.port}`);
  if (h.auth === 'local') lines.push('ip http authentication local');
  return lines;
}

/**
 * Privilege level granted to web credentials, or null when they are refused.
 * `enable`: any user name with the enable secret/password (level 15); without one, nobody gets in.
 * `local`: a `username` entry and its secret or password.
 */
export function httpPrivilege(device: IosDevice, user: string, password: string): number | null {
  if (device.http.auth === 'enable') {
    if (device.enableSecret !== undefined) return secretHash(password) === device.enableSecret ? MAX_PRIVILEGE : null;
    if (device.enablePassword !== undefined) return password === device.enablePassword ? MAX_PRIVILEGE : null;
    return null;
  }
  const u = device.users.find((x) => x.name === user);
  if (!u) return null;
  const ok = u.secret !== undefined ? secretHash(password) === u.secret : password === u.password;
  return ok ? u.privilege : null;
}
