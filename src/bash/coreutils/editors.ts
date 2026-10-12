/** nano, vim, vi and view: open the full-screen editor of the terminal through an `edit` interaction. */
import type { CommandFn, Ctx, EditSpec, Gen } from '../types.ts';
import { canAccess, dirname, FsError } from '../vfs.ts';

type Editor = EditSpec['editor'];

interface EditArgs {
  readonly file?: string;
  readonly line?: number;
  readonly readOnly: boolean;
  readonly error?: string;
}

const NANO_VERSION = ' GNU nano, version 8.4\n (C) 2025 the Free Software Foundation and various contributors\n Compiled options: --enable-utf8\n';
const VIM_VERSION = 'VIM - Vi IMproved 9.1 (2024 Jan 02, compiled Sep 25 2026 10:12:03)\nIncluded patches: 1-1234\nModified by team+vim@tracker.debian.org\nCompiled by team+vim@tracker.debian.org\nHuge version without GUI.\n';

function parseArgs(args: readonly string[], editor: Editor): EditArgs {
  let file: string | undefined;
  let line: number | undefined;
  let readOnly = false;
  for (const a of args) {
    if (/^\+\d+(,\d+)?$/.test(a)) line = Number(a.slice(1).split(',')[0]);
    else if (a === '+') line = Number.MAX_SAFE_INTEGER;
    else if (a === '-R' || a === '-v' || a === '--view') readOnly = true;
    else if (a.startsWith('-') && a !== '-') {
      if (editor === 'vim' && !/^-[nNXZe]$/.test(a)) return { readOnly, error: `VIM - Vi IMproved 9.1 (2024 Jan 02)\nUnknown option argument: "${a}"\nMore info with: "vim -h"\n` };
      if (editor === 'nano' && !/^-[lmiEAS]+$/.test(a)) return { readOnly, error: `nano: invalid option -- '${a.replace(/^-+/, '')}'\nType 'nano -h' for a list of available options.\n` };
    } else if (file === undefined) file = a;
  }
  return { file, line, readOnly };
}

function loadSpec(ctx: Ctx, editor: Editor, a: EditArgs): EditSpec | string {
  if (a.file === undefined) return { editor, path: '', content: '', exists: false, readOnly: a.readOnly, line: a.line };
  const fs = ctx.sh.env.fs;
  const path = ctx.resolve(a.file);
  const node = fs.tryLookup(path, ctx.cred);
  if (node?.kind === 'dir') return `"${a.file}" is a directory`;
  if (!node) {
    const parent = fs.tryLookup(dirname(path), ctx.cred);
    const writable = parent?.kind === 'dir' && canAccess(parent, ctx.cred, 2);
    return { editor, path, content: '', exists: false, readOnly: a.readOnly || !writable, line: a.line };
  }
  try {
    const content = fs.readFile(path, ctx.cred);
    return { editor, path, content, exists: true, readOnly: a.readOnly || !canAccess(node, ctx.cred, 2) || fs.stat(path).generated, line: a.line };
  } catch (e) {
    if (e instanceof FsError && e.code === 'EACCES') return `Permission denied: ${a.file}`;
    throw e;
  }
}

function editorFn(editor: Editor, forceReadOnly: boolean): CommandFn {
  return function* edit(ctx: Ctx): Gen<number> {
    const args = ctx.argv.slice(1);
    if (args.includes('--version') || (args.includes('-V') && editor === 'nano')) { ctx.out(editor === 'nano' ? NANO_VERSION : VIM_VERSION); return 0; }
    const parsed = parseArgs(args, editor);
    if (parsed.error) { ctx.err(parsed.error); return 1; }
    const spec = loadSpec(ctx, editor, { ...parsed, readOnly: parsed.readOnly || forceReadOnly });
    if (typeof spec === 'string') { ctx.err(`${spec}\n`); return 1; }
    const fs = ctx.sh.env.fs;
    const cred = ctx.cred;
    const save = (path: string, content: string): string | null => {
      try {
        fs.writeFile(ctx.resolve(path), content, cred);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    const status = yield { kind: 'edit', spec, save };
    return Number(status ?? 0) || 0;
  };
}

export const EDITORS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['nano', editorFn('nano', false)], ['vim', editorFn('vim', false)], ['vi', editorFn('vim', false)], ['view', editorFn('vim', true)],
]);
