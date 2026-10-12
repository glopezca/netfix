import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_GROUPS, findPage, searchDocs, manPage, apropos, fold } from '../../src/docs/index.ts';
import { UTIL_DOCS } from '../../src/docs/utils.ts';
import { BUILTIN_DOCS } from '../../src/docs/bash-builtins.ts';
import { COREUTILS } from '../../src/bash/coreutils/index.ts';
import { BUILTINS } from '../../src/bash/builtins/index.ts';
import { runScript } from '../bash/harness.ts';

/** Programs that are another name of a documented one. */
const ALIASES = new Set(['[', 'dir', 'egrep', 'fgrep', 'mawk', 'sh', 'rbash', 'vi', 'view', 'command-not-found']);

test('every page has a unique id, a title, a summary and content', () => {
  const pages = DOC_GROUPS.flatMap((g) => g.pages);
  assert.equal(new Set(pages.map((p) => p.id)).size, pages.length);
  for (const p of pages) assert.ok(p.title && p.summary && p.blocks.length > 0, p.id);
  assert.ok(DOC_GROUPS.some((g) => g.id === 'bash') && DOC_GROUPS.some((g) => g.id === 'servicios'));
});

test('every builtin and every program of the terminal is documented', () => {
  for (const b of BUILTINS.keys()) assert.ok(BUILTIN_DOCS[b], `builtin ${b}`);
  for (const c of COREUTILS.keys()) assert.ok(UTIL_DOCS[c] || ALIASES.has(c), `programa ${c}`);
  for (const c of ['ip', 'ping', 'dig', 'nslookup', 'host', 'curl', 'wget', 'ssh', 'dhclient', 'systemctl', 'service', 'journalctl', 'ss', 'a2ensite', 'a2enmod', 'a2enconf', 'apache2ctl']) assert.ok(UTIL_DOCS[c], c);
});

test('search ignores accents and case and ranks titles first', () => {
  assert.equal(fold('Órdenes'), 'ordenes');
  const hits = searchDocs('NANO');
  assert.equal(hits[0]?.page.id, 'nano');
  assert.ok(searchDocs('client-identifier').some((h) => h.page.id === 'ios-reservas'));
  assert.ok(searchDocs('origin relativo').some((h) => h.page.id === 'srv-dns'));
  assert.deepEqual(searchDocs('   '), []);
  assert.deepEqual(searchDocs('zzzqqq'), []);
  assert.equal(findPage('vim')?.title, 'vim');
});

test('man pages follow the man(1) layout; man -k searches summaries', () => {
  const ls = manPage('ls') ?? '';
  assert.match(ls, /^LS\(1\) +User Commands +LS\(1\)\n\nNAME\n {7}ls - /);
  assert.match(ls, /\nSYNOPSIS\n {7}ls \[OPCIÓN\]/);
  assert.match(manPage('ip') ?? '', /^IP\(8\) +System Administration +IP\(8\)/);
  assert.match(manPage('vi') ?? '', /KEYS\n {7}i a I A o O/);
  assert.match(manPage('bash') ?? '', /SHELL BUILTIN COMMANDS[\s\S]*declare/);
  assert.equal(manPage('nada'), null);
  assert.ok(apropos('DNS').some((l) => l.startsWith('dig (1)')));
});

test('man, less, shuf and tree in the terminal', () => {
  assert.equal(runScript('man ls | head -1').out, `${manPage('ls')?.split('\n')[0]}\n`);
  assert.equal(runScript('man cd').out, 'No manual entry for cd\n(cd es una orden interna de bash: prueba «help cd»)\n');
  assert.equal(runScript('man').status, 1);
  assert.equal(runScript('man -k zzz').status, 16);
  assert.equal(runScript('printf "a\\nb\\n" > f; less f; more < f').out, 'a\nb\na\nb\n');
  assert.equal(runScript('shuf -i 1-5 | sort -n | tr "\\n" " "; shuf -e x | wc -l; printf "1\\n2\\n" | shuf -n 1 | wc -l; shuf -i 5-1').out, '1 2 3 4 5 1\n1\nshuf: invalid input range: ‘5-1’\n');
  assert.equal(runScript('mkdir -p d/e/g; touch d/e/f d/.h; tree -L 1 d; tree -d d; tree -a -L 1 d; tree -L 0').out,
    'd\n└── e\n\n1 directory, 0 files\nd\n└── e\n    └── g\n\n2 directories\nd\n├── .h\n└── e\n\n1 directory, 1 file\ntree: Invalid level, must be greater than 0.\n');
});
