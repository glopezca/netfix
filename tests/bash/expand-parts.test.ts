/** Pure pieces of word expansion, checked against real bash 5 output. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { braceExpand } from '../../src/bash/brace.ts';
import { matchPattern, hasGlob, trimPattern, replacePattern } from '../../src/bash/glob.ts';
import { Arith, ArithError } from '../../src/bash/arith.ts';
import { parseWord, decodeAnsi } from '../../src/bash/wordparse.ts';

test('brace expansion matches bash', () => {
  const words = 'a{b,c{d,e}}f {1..5..2} {05..1} {a..e..2} {-2..2} x{,y}z "{a,b}" \\{a,b\\} {a} ${HOME:+{x,y}}'.split(' ');
  const out = words.flatMap((w) => braceExpand(w));
  assert.deepEqual(out, ['abf', 'acdf', 'acef', '1', '3', '5', '05', '04', '03', '02', '01', 'a', 'c', 'e', '-2', '-1', '0', '1', '2', 'xz', 'xyz', '"{a,b}"', '\\{a,b\\}', '{a}', '${HOME:+{x,y}}']);
});

test('glob patterns', () => {
  assert.ok(matchPattern('*.txt', 'a.txt'));
  assert.ok(!matchPattern('*.txt', 'a.txt.bak'));
  assert.ok(matchPattern('[a-c]?[!0-9]', 'bxz'));
  assert.ok(!matchPattern('[a-c]?[!0-9]', 'bx1'));
  assert.ok(matchPattern('[[:digit:]][[:alpha:]]', '7q'));
  assert.ok(matchPattern('@(foo|bar).c', 'bar.c'));
  assert.ok(matchPattern('+(ab)', 'ababab'));
  assert.ok(matchPattern('!(*.c)', 'x.h'));
  assert.ok(!matchPattern('!(*.c)', 'x.c'));
  assert.ok(matchPattern('\\*', '*'));
  assert.ok(!matchPattern('\\*', 'x'));
  assert.ok(!matchPattern('*', 'a/b', { pathname: true }));
  assert.ok(matchPattern('A*', 'abc', { nocase: true }));
  assert.ok(hasGlob('a*') && hasGlob('x[ab]') && !hasGlob('a\\*') && hasGlob('@(a)'));
});

test('trim and replace like ${v#p} ${v%%p} ${v//p/s}', () => {
  const path = '/usr/local/lib/libx.so.1';
  assert.equal(trimPattern(path, '*/', 'prefix', false), 'usr/local/lib/libx.so.1');
  assert.equal(trimPattern(path, '*/', 'prefix', true), 'libx.so.1');
  assert.equal(trimPattern(path, '.*', 'suffix', false), '/usr/local/lib/libx.so');
  assert.equal(trimPattern(path, '.*', 'suffix', true), '/usr/local/lib/libx');
  assert.equal(replacePattern('a-b-c', '-', '+', 'first'), 'a+b-c');
  assert.equal(replacePattern('a-b-c', '-', '+', 'all'), 'a+b+c');
  assert.equal(replacePattern('abcabc', 'a', 'X', 'start'), 'Xbcabc');
  assert.equal(replacePattern('abcabc', 'c', 'X', 'end'), 'abcabX');
  assert.equal(replacePattern('aaa', 'a*', 'X', 'all'), 'X');
});

test('arithmetic matches bash', () => {
  const vars = new Map<string, string>();
  const arr = new Map<string, string>([['0', '1'], ['1', '2'], ['2', '3']]);
  const a = new Arith({
    get: (n, sub) => (n === 'a' ? arr.get(String(sub === undefined ? 0 : new Arith({ get: (k) => vars.get(k), set: () => undefined }).eval(sub))) : vars.get(n)),
    set: (n, _s, v) => { vars.set(n, v); },
  });
  const exprs = ['7/2', '-7/2', '-7%3', '2**63', '2**64', '1<<65', '0x1F', '017', '2#101', '36#zz', '64#_', 'x=5, x*=3, x', '-2**2', '5>3?10:20', '!0', '~5', '3>2 && 0 || 7'];
  assert.deepEqual(exprs.map((e) => String(a.eval(e))), ['3', '-3', '-1', '-9223372036854775808', '0', '2', '31', '15', '5', '1295', '63', '15', '4', '10', '1', '-6', '1']);
  vars.set('y', '3');
  vars.set('x', 'y+1');
  assert.equal(a.eval('x*2'), 8n);
  vars.set('i', '1');
  assert.equal(a.eval('a[i]+a[2]'), 5n);
  assert.deepEqual([a.eval('++i'), a.eval('i++'), a.eval('i')], [2n, 2n, 3n]);
  assert.equal(a.eval('2**4000000000000'), 0n);
});

test('arithmetic errors use bash wording', () => {
  const a = new Arith({ get: () => undefined, set: () => undefined });
  const msg = (e: string): string => { try { a.eval(e); return 'ok'; } catch (x) { return x instanceof ArithError ? x.message : 'other'; } };
  assert.equal(msg('1/0'), '1/0: division by 0 (error token is "0")');
  assert.equal(msg('1+'), '1+: syntax error: operand expected (error token is "+")');
  assert.equal(msg('08'), '08: value too great for base (error token is "08")');
});

test('word parts and ANSI-C quoting', () => {
  assert.deepEqual(parseWord(`a"b $x"'c'\\d$'\\t'$(ls)\${v:-z}$((1+2))\${ echo; }\${|REPLY=1;}`), [
    { t: 'lit', v: 'a' }, { t: 'dq', parts: [{ t: 'q', v: 'b ' }, { t: 'param', body: 'x' }] }, { t: 'q', v: 'c' }, { t: 'q', v: 'd' }, { t: 'q', v: '\t' },
    { t: 'cmd', src: 'ls', mode: 'sub' }, { t: 'param', body: 'v:-z' }, { t: 'arith', expr: '1+2' }, { t: 'cmd', src: ' echo; ', mode: 'cur' }, { t: 'cmd', src: 'REPLY=1;', mode: 'val' },
  ]);
  assert.equal(decodeAnsi('a\\x41\\101\\u00e9\\n\\cA'), 'aAAé\n\x01');
});
