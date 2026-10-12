import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, BashSyntaxError, IncompleteInput } from '../../src/bash/parser.ts';
import type { Command, List, SimpleCommand } from '../../src/bash/ast.ts';

const first = (src: string): Command => (parse(src).items[0]?.cmd as Command);
const simple = (src: string): SimpleCommand => first(src) as SimpleCommand;
const words = (src: string): string[] => simple(src).words.map((w) => w.raw);

test('words keep quotes and nested substitutions', () => {
  assert.deepEqual(words(`echo "a b" 'c d' $'e\\'f' x\\ y $(echo ")") \${v:-"}"} \`date\` $((1 + (2)))`),
    ['echo', '"a b"', "'c d'", "$'e\\'f'", 'x\\ y', '$(echo ")")', '${v:-"}"}', '`date`', '$((1 + (2)))']);
  assert.deepEqual(words('ls @(a|b) !(c) <(echo hi)'), ['ls', '@(a|b)', '!(c)', '<(echo hi)']);
  assert.deepEqual(words('echo a#b # comment'), ['echo', 'a#b']);
});

test('assignments, arrays and declarations', () => {
  const c = simple('A=1 B[2]+=x C=(1 "2 3" [k]=v) cmd arg');
  assert.deepEqual(c.assigns.map((a) => [a.name, a.index, a.append, a.value?.raw]), [['A', undefined, false, '1'], ['B', '2', true, 'x'], ['C', undefined, false, undefined]]);
  assert.deepEqual(c.assigns[2]?.array?.map((e) => [e.key, e.value.raw]), [[undefined, '1'], [undefined, '"2 3"'], ['k', 'v']]);
  assert.deepEqual(c.words.map((w) => w.raw), ['cmd', 'arg']);
  const d = simple('local -a x=(1 2) y=3 z');
  assert.ok(d.words[2]?.assign?.array);
  assert.equal(d.words[3]?.assign?.value?.raw, '3');
  assert.equal(d.words[4]?.assign, undefined);
});

test('redirections with descriptors and here-documents', () => {
  const c = simple('cmd 2>&1 >out <<EOF 3<in {fd}>log &>>all\nhola $x\nEOF\n');
  assert.deepEqual(c.redirs.map((r) => [r.fd, r.varFd, r.op, r.target.raw]), [[2, undefined, '>&', '1'], [undefined, undefined, '>', 'out'], [undefined, undefined, '<<', 'EOF'], [3, undefined, '<', 'in'], [undefined, 'fd', '>', 'log'], [undefined, undefined, '&>>', 'all']]);
  assert.equal(c.redirs[2]?.heredoc?.body, 'hola $x\n');
  const q = simple("cat <<-'X'\n\tliteral $y\n\tX\n");
  assert.deepEqual([q.redirs[0]?.heredoc?.body, q.redirs[0]?.heredoc?.quoted], ['literal $y\n', true]);
});

test('lists, pipelines and and-or', () => {
  const l = parse('a | b |& c && ! d || e & f; g\nh');
  assert.equal(l.items.length, 4);
  assert.equal(l.items[0]?.async, true);
  const ao = l.items[0]?.cmd as { kind: string; rest: unknown[] };
  assert.equal(ao.kind, 'and_or');
  assert.equal(ao.rest.length, 2);
  assert.equal(l.items[0]?.source, 'a | b |& c && ! d || e');
});

test('compound commands', () => {
  const kinds = (src: string): string => first(src).kind;
  assert.equal(kinds('if a; then b; elif c; then d; else e; fi'), 'if');
  assert.equal(kinds('while read l; do echo $l; done < f'), 'while');
  assert.equal(kinds('until false; do :; done'), 'while');
  assert.equal(kinds('for i in 1 2 3; do echo $i; done'), 'for');
  assert.equal(kinds('for i; do :; done'), 'for');
  assert.equal(kinds('for ((i=0; i<3; i++)); do :; done'), 'arith_for');
  assert.equal(kinds('select x in a b; do break; done'), 'select');
  assert.equal(kinds('case $x in a|b) echo ab;; *) echo other;& (c) :;;& esac'), 'case');
  assert.equal(kinds('(( x = 1 + 2 ))'), 'arith');
  assert.equal(kinds('[[ -f a && ( $x == y* || ! -z $z ) ]]'), 'cond');
  assert.equal(kinds('{ echo a; echo b; } > out'), 'group');
  assert.equal(kinds('( cd /; ls )'), 'subshell');
  const f = first('function greet { echo hi; }') as { kind: string; name: string; source: string };
  assert.deepEqual([f.kind, f.name, f.source], ['function', 'greet', 'function greet { echo hi; }']);
  assert.equal((first('greet ()\n{\n echo hi\n}') as { name: string }).name, 'greet');
});

test('regex on the right of =~ keeps parentheses and bars', () => {
  const c = first('[[ $x =~ ^(ab|cd)[0-9]+$ ]]') as { expr: { kind: string; right: { raw: string } } };
  assert.equal(c.expr.right.raw, '^(ab|cd)[0-9]+$');
});

test('incomplete input asks for more lines', () => {
  for (const src of ['if true; then', 'echo "abc', 'for i in 1; do', 'a |', 'a &&', 'echo $(ls', "echo 'x", 'f() {', 'case x in', 'echo \\', 'cat <<EOF\nline']) {
    assert.throws(() => parse(src, true), IncompleteInput, src);
  }
});

test('syntax errors name the unexpected token', () => {
  const err = (src: string): string => {
    try {
      parse(src);
    } catch (e) {
      if (e instanceof BashSyntaxError) return e.message;
    }
    return 'no error';
  };
  assert.equal(err('fi'), "syntax error near unexpected token `fi'");
  assert.equal(err('echo a; ;'), "syntax error near unexpected token `;'");
  assert.equal(err('if true; then fi'), "syntax error near unexpected token `fi'");
  assert.equal(err('echo )'), "syntax error near unexpected token `)'");
  assert.equal(err('( )'), "syntax error near unexpected token `)'");
});

test('empty program and comments', () => {
  const l: List = parse('# only a comment\n\n');
  assert.equal(l.items.length, 0);
});
