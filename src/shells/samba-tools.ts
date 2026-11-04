/**
 * Samba's checking and listing tools: testparm (samba-common-bin) reads smb.conf, warns about unknown parameters and
 * dumps the sections it understood; pdbedit -L (samba) lists the Samba accounts as user:uid:full name.
 */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { SMB_CONF, smbSections } from '../services/smb-conf.ts';
import type { SmbSection } from '../services/smb-conf.ts';
import { readPassdb } from '../services/smb-passdb.ts';

const TESTPARM_USAGE = 'Usage: testparm [-s] [-v] [--show-all-parameters] [config_file]\n';
const PDBEDIT_USAGE = 'Usage: pdbedit [-L]\n  -L, --list     list all users\n';

function notFound(ctx: Ctx, cmd: string, pkg: string): number {
  ctx.err(`Command '${cmd}' not found, but can be installed with:\nsudo apt install ${pkg}\n`);
  return 127;
}

/** testparm writes booleans as Yes / No, whatever the file says. */
function shown(value: string): string {
  if (/^(yes|true)$/i.test(value)) return 'Yes';
  if (/^(no|false)$/i.test(value)) return 'No';
  return value;
}

/** [global] keeps the order of the file; shares are sorted by parameter, as testparm prints them. */
function dump(sections: readonly SmbSection[]): string {
  const block = (s: SmbSection, global: boolean): string => {
    const params = [...s.params.entries()];
    if (!global) params.sort(([a], [b]) => a.localeCompare(b));
    return [`[${s.name}]`, ...params.map(([k, v]) => `\t${k} = ${shown(v)}`)].join('\n');
  };
  const global = sections.find((s) => s.name.toLowerCase() === 'global') ?? { name: 'global', params: new Map<string, string>() };
  const shares = sections.filter((s) => s.name.toLowerCase() !== 'global').map((s) => block(s, false));
  return `# Global parameters\n${[block(global, true), ...shares].join('\n\n')}\n`;
}

function* testparmRun(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const silent = args.some((a) => a === '-s' || a === '--suppress-prompt');
  const files = args.filter((a) => !a.startsWith('-'));
  if (files.length > 1 || args.some((a) => a.startsWith('-') && !['-s', '--suppress-prompt', '-v', '--verbose', '--show-all-parameters'].includes(a))) {
    ctx.err(TESTPARM_USAGE);
    return 1;
  }
  const path = files[0] ?? SMB_CONF;
  ctx.err(`Load smb config files from ${path}\n`);
  let text: string;
  try {
    text = ctx.sh.env.fs.readFile(ctx.resolve(path), ctx.cred);
  } catch {
    ctx.err(`Error loading services.\n`);
    return 1;
  }
  const { sections, unknown } = smbSections(text);
  for (const p of unknown) ctx.err(`Unknown parameter encountered: "${p}"\nIgnoring unknown parameter "${p}"\n`);
  ctx.err('Loaded services file OK.\nWeak crypto is allowed by GnuTLS (e.g. NTLM as a compatibility fallback)\n\nServer role: ROLE_STANDALONE\n\n');
  if (!silent) {
    ctx.err('Press enter to see a dump of your service definitions\n');
    yield* ctx.readLine();
  }
  ctx.out(dump(sections));
  return 0;
}

export function testparm(host: Host): CommandFn {
  return (ctx) => (hasPackage(host, 'samba-common-bin') ? testparmRun(ctx) : notFound(ctx, 'testparm', 'samba-common-bin'));
}

function pdbeditRun(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (!args.length || args.some((a) => a !== '-L' && a !== '--list')) {
    ctx.err(PDBEDIT_USAGE);
    return 1;
  }
  if (ctx.cred.uid !== 0) {
    ctx.err('Unable to initialise the passdb backend: NT_STATUS_ACCESS_DENIED\n');
    return 1;
  }
  const accounts = readPassdb(ctx.sh.env.fs);
  if (accounts.length) ctx.out(`${accounts.map((a) => `${a.name}:${a.uid}:`).join('\n')}\n`);
  return 0;
}

export function pdbedit(host: Host): CommandFn {
  return (ctx) => (hasPackage(host, 'samba') ? pdbeditRun(ctx) : notFound(ctx, 'pdbedit', 'samba'));
}
