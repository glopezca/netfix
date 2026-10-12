/** Prints commands back as bash does (print_cmd.c): `declare -f`, `type` and `${f@…}` use this layout. */
import type { Assignment, Command, CondExpr, FunctionDef, Redirect, Word } from './ast.ts';

const IND = '    ';
const pad = (depth: number): string => IND.repeat(depth);

function assignText(a: Assignment): string {
  const lhs = `${a.name}${a.index !== undefined ? `[${a.index}]` : ''}${a.append ? '+=' : '='}`;
  if (a.array) return `${lhs}(${a.array.map((e) => (e.key !== undefined ? `[${e.key}]=${e.value.raw}` : e.value.raw)).join(' ')})`;
  return lhs + (a.value?.raw ?? '');
}

function redirText(r: Redirect): string {
  const fd = r.varFd !== undefined ? `{${r.varFd}}` : r.fd !== undefined ? String(r.fd) : r.op === '>&' ? '1' : '';
  if (r.op === '<<' || r.op === '<<-') return `${fd}${r.op}${r.target.raw}`;
  if (r.op === '>&' || r.op === '<&') return `${fd}${r.op}${r.target.raw}`;
  return `${fd}${r.op} ${r.target.raw}`;
}

function heredocs(redirs: readonly Redirect[]): string {
  return redirs.filter((r) => r.heredoc).map((r) => `\n${r.heredoc?.body ?? ''}${r.target.raw.replace(/['"\\]/g, '')}`).join('');
}

function withRedirs(text: string, redirs: readonly Redirect[]): string {
  return redirs.length ? `${text} ${redirs.map(redirText).join(' ')}` : text;
}

function condText(e: CondExpr): string {
  switch (e.kind) {
    case 'unary': return `${e.op} ${e.arg.raw}`;
    case 'binary': return `${e.left.raw} ${e.op} ${e.right.raw}`;
    case 'not': return `! ${condText(e.expr)}`;
    case 'and': return `${condText(e.left)} && ${condText(e.right)}`;
    case 'or': return `${condText(e.left)} || ${condText(e.right)}`;
    case 'word': return e.arg.raw;
  }
}

interface Item {
  readonly cmd: Command;
  readonly async: boolean;
}

function items(cmd: Command): Item[] {
  return cmd.kind === 'list' ? cmd.items.map((i) => ({ cmd: i.cmd, async: i.async })) : [{ cmd, async: false }];
}

/** A command list, one command per line at `depth`; `lastSemi` puts `;` after the last one too. */
function block(cmd: Command, depth: number, lastSemi: boolean): string {
  const list = items(cmd);
  let text = '';
  list.forEach((it, i) => {
    const docs = it.cmd.kind === 'simple' ? heredocs(it.cmd.redirs) : '';
    const term = it.async ? ' &' : i < list.length - 1 || lastSemi ? ';' : '';
    const sep = i === 0 ? pad(depth) : list[i - 1]?.async ? ' ' : `\n${pad(depth)}`;
    text += `${sep}${inline(it.cmd, depth)}${term}${docs}`;
  });
  return text;
}

/** A condition list on one line (`if a; b; then`). */
function oneLine(cmd: Command, depth: number): string {
  const list = items(cmd);
  return list.map((it, i) => `${inline(it.cmd, depth)}${it.async ? ' &' : i < list.length - 1 ? ';' : ''}`).join(' ');
}

function loop(head: string, body: Command, depth: number, doOnNewLine: boolean): string {
  const open = doOnNewLine ? `${head};\n${pad(depth)}do` : `${head}; do`;
  return `${open}\n${block(body, depth + 1, true)}\n${pad(depth)}done`;
}

function wordsText(words: readonly Word[] | undefined): string {
  return words ? words.map((w) => w.raw).join(' ') : '"$@"';
}

function compoundText(cmd: Exclude<Command, { kind: 'simple' | 'pipeline' | 'and_or' | 'list' | 'function' }>, depth: number): string {
  switch (cmd.kind) {
    case 'group': return `{ \n${block(cmd.body, depth + 1, false)}\n${pad(depth)}}`;
    case 'subshell': return `( ${block(cmd.body, depth, false).slice(pad(depth).length)} )`;
    case 'if': {
      const [first, ...rest] = cmd.clauses;
      if (!first) return '';
      const elseBody: Command | undefined = rest.length ? { kind: 'if', clauses: rest, elseBody: cmd.elseBody, redirs: [] } : cmd.elseBody;
      const head = `if ${oneLine(first.cond, depth)}; then\n${block(first.body, depth + 1, true)}`;
      const tail = elseBody ? `\n${pad(depth)}else\n${block(elseBody, depth + 1, true)}` : '';
      return `${head}${tail}\n${pad(depth)}fi`;
    }
    case 'while': return loop(`${cmd.until ? 'until' : 'while'} ${oneLine(cmd.cond, depth)}`, cmd.body, depth, false);
    case 'for': return loop(`for ${cmd.name} in ${wordsText(cmd.words)}`, cmd.body, depth, true);
    case 'select': return loop(`select ${cmd.name} in ${wordsText(cmd.words)}`, cmd.body, depth, true);
    case 'arith_for': return `for ((${cmd.init}; ${cmd.cond}; ${cmd.step}))\n${pad(depth)}do\n${block(cmd.body, depth + 1, true)}\n${pad(depth)}done`;
    case 'case': {
      const arms = cmd.items.map((it) => `${pad(depth + 1)}${it.patterns.map((p) => p.raw).join(' | ')})\n${it.body ? `${block(it.body, depth + 2, false)}\n` : ''}${pad(depth + 1)}${it.term}`);
      return `case ${cmd.word.raw} in \n${arms.join('\n')}\n${pad(depth)}esac`;
    }
    case 'arith': return `(( ${cmd.expr.trim()} ))`;
    case 'cond': return `[[ ${condText(cmd.expr)} ]]`;
  }
}

function inline(cmd: Command, depth: number): string {
  switch (cmd.kind) {
    case 'simple': return [...cmd.assigns.map(assignText), ...cmd.words.map((w) => w.raw), ...cmd.redirs.map(redirText)].join(' ');
    case 'pipeline': {
      const body = cmd.cmds.map((c, i) => `${inline(c, depth)}${i < cmd.cmds.length - 1 ? (cmd.stderrToPipe[i] ? ' |&' : ' |') : ''}`).join(' ');
      return `${cmd.timed ? 'time ' : ''}${cmd.negate ? '! ' : ''}${body}`;
    }
    case 'and_or': return [inline(cmd.first, depth), ...cmd.rest.map((r) => `${r.op} ${inline(r.cmd, depth)}`)].join(' ');
    case 'list': return oneLine(cmd, depth);
    case 'function': return functionAt(cmd, depth);
    default: return withRedirs(compoundText(cmd, depth), cmd.redirs);
  }
}

function functionAt(def: FunctionDef, depth: number): string {
  return `${def.name} () \n${pad(depth)}${inline(def.body, depth)}`;
}

/** `declare -f name` text. */
export function functionText(def: FunctionDef): string {
  return functionAt(def, 0);
}

/** A command as one display string (used for BASH_COMMAND-like messages and job lists). */
export function commandText(cmd: Command): string {
  return inline(cmd, 0);
}
