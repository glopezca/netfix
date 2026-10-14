/** nft (nftables 1.1) for the Ubuntu shell: commands, -f files, -c checks, -a handles, -s stateless. */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { runNft } from '../net/nft/apply.ts';
import { FsError } from '../bash/vfs.ts';

const VERSION = 'nftables v1.1.1 (Commodore Bullseye 2)';
const USAGE = `Usage: nft [ options ] [ cmds... ]

Options (general):
  -h, --help                      Show this help
  -v, --version                   Show version information
  -V                              Show extended version information

Options (ruleset input handling):
  -f, --file <filename>           Read input from <filename>
  -c, --check                     Check commands validity without actually applying the changes.

Options (ruleset list formatting):
  -a, --handle                    Output rule handle.
  -s, --stateless                 Omit stateful information of ruleset.
  -n, --numeric                   Print fully numerical output.
`;

interface Opts {
  file?: string;
  check: boolean;
  handles: boolean;
  stateless: boolean;
  words: string[];
}

function parse(argv: readonly string[]): Opts | string {
  const o: Opts = { check: false, handles: false, stateless: false, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (o.words.length || !a.startsWith('-')) { o.words.push(a); continue; }
    if (a === '-f' || a === '--file') { o.file = argv[++i]; if (o.file === undefined) return 'nft: option requires an argument -- \'f\''; continue; }
    if (a === '-j' || a === '--json') return 'Error: JSON support not compiled-in';
    if (a === '-i' || a === '--interactive') return 'Error: interactive CLI not supported in this build';
    for (const f of a.replace(/^--?/, '').split(a.startsWith('--') ? /$/ : '')) {
      if (f === 'a' || f === 'handle') o.handles = true;
      else if (f === 'c' || f === 'check') o.check = true;
      else if (f === 's' || f === 'stateless') o.stateless = true;
      else if (!['n', 'numeric', 'N', 'S', 'y', 'e', 'echo', 't', 'terse'].includes(f)) return `nft: unrecognized option '${a}'\n${USAGE}`;
    }
  }
  return o;
}

function readAs(ctx: Ctx, path: string): string | null {
  try {
    return ctx.sh.env.fs.readFile(ctx.resolve(path), ctx.cred);
  } catch (e) {
    if (e instanceof FsError && e.code === 'ENOENT') return null;
    throw e;
  }
}

export function nft(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    const args = ctx.argv.slice(1);
    if (args[0] === '-v' || args[0] === '--version' || args[0] === '-V') { ctx.out(`${VERSION}\n`); return 0; }
    if (args[0] === '-h' || args[0] === '--help') { ctx.out(USAGE); return 0; }
    const o = parse(args);
    if (typeof o === 'string') { ctx.err(`${o}\n`); return 1; }
    if (ctx.cred.uid !== 0) { ctx.err('netlink: Error: cache initialization failed: Operation not permitted\n'); return 1; }
    let src = o.words.join(' ');
    if (o.file !== undefined) {
      const text = o.file === '-' || o.file === '/dev/stdin' ? yield* ctx.readAll() : readAs(ctx, o.file);
      if (text === null) { ctx.err(`Error: Could not open file "${o.file}": No such file or directory\n`); return 1; }
      src = text;
    }
    if (!src.trim()) { ctx.err(USAGE); return 1; }
    const nf = host.kernel.netfilter;
    const r = runNft(nf.ruleset, src, {
      read: (p) => readAs(ctx, p),
      format: { handles: o.handles, counters: o.stateless ? new Map() : nf.counters },
    });
    if (!r.ok) {
      ctx.err(`${o.file !== undefined ? `${o.file}: ` : ''}${r.error}\n`);
      return 1;
    }
    if (!o.check) nf.setRuleset(r.ruleset);
    const out = o.stateless ? r.output.map((l) => l.replace(/ counter packets \d+ bytes \d+/, ' counter')) : r.output;
    if (out.length) ctx.out(`${out.join('\n')}\n`);
    return 0;
  };
}
