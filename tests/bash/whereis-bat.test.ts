/** whereis and batcat (bat on Ubuntu). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './harness.ts';
import { highlight, languageFor } from '../../src/bash/coreutils/syntax.ts';

const strip = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

test('whereis finds binaries, configuration directories and manual pages', () => {
  assert.equal(runScript('whereis ls').out, 'ls: /usr/bin/ls /usr/share/man/man1/ls.1.gz\n');
  assert.equal(runScript('whereis -b ls grep').out, 'ls: /usr/bin/ls\ngrep: /usr/bin/grep\n');
  assert.equal(runScript('whereis -m ls').out, 'ls: /usr/share/man/man1/ls.1.gz\n');
  assert.equal(runScript('whereis nada').out, 'nada:\n');
  assert.equal(runScript('whereis bash').out, 'bash: /usr/bin/bash /etc/bash.bashrc /usr/share/man/man1/bash.1.gz\n');
  assert.match(runScript('whereis -l').out, /^bin: \/usr\/bin\n/);
});

test('languages are chosen by name, extension or shebang', () => {
  assert.equal(languageFor('script.sh', ''), 'bash');
  assert.equal(languageFor('x', '#!/bin/bash\necho'), 'bash');
  assert.equal(languageFor('000-default.conf', ''), 'apache');
  assert.equal(languageFor('index.html', ''), 'html');
  assert.equal(languageFor('datos.json', ''), 'json');
  assert.equal(languageFor('netplan.yaml', ''), 'yaml');
  assert.equal(languageFor('a.py', ''), 'python');
  assert.equal(languageFor('db.aula.lab', ''), 'dns');
  assert.equal(languageFor('notas.txt', ''), 'text');
});

test('highlighting colours tokens without changing the text', () => {
  const src = '#!/bin/bash\n# comentario\nif [ -f "$HOME/x" ]; then echo 42; fi';
  const out = highlight(src, 'bash');
  assert.equal(strip(out), src);
  assert.match(out, /\x1b\[38;5;\d+mif\x1b\[0m/);
  assert.match(out, /\x1b\[38;5;\d+m# comentario\x1b\[0m/);
  assert.match(out, /\x1b\[38;5;\d+m"\$HOME\/x"\x1b\[0m/);
  assert.equal(strip(highlight('<VirtualHost *:80>\n  DocumentRoot /var/www/html\n</VirtualHost>', 'apache')), '<VirtualHost *:80>\n  DocumentRoot /var/www/html\n</VirtualHost>');
  assert.equal(highlight('hola', 'text'), 'hola');
});

test('batcat on a terminal draws the header, the grid and line numbers', () => {
  const r = runScript('printf "echo hola\\necho adios\\n" > saludo.sh; batcat saludo.sh', { tty: true });
  const lines = strip(r.out).split('\n');
  assert.equal(lines[0], `${'─'.repeat(7)}┬${'─'.repeat(72)}`);
  assert.equal(lines[1], '       │ File: saludo.sh');
  assert.equal(lines[2], `${'─'.repeat(7)}┼${'─'.repeat(72)}`);
  assert.equal(lines[3], '   1   │ echo hola');
  assert.equal(lines[4], '   2   │ echo adios');
  assert.equal(lines[5], `${'─'.repeat(7)}┴${'─'.repeat(72)}`);
});

test('batcat styles, plain output when piped, ranges and errors', () => {
  assert.equal(runScript('printf "a\\nb\\n" > f; batcat f | cat').out, 'a\nb\n');
  assert.equal(strip(runScript('printf "a\\nb\\n" > f; batcat -n f', { tty: true }).out), '   1 a\n   2 b\n');
  assert.equal(strip(runScript('printf "a\\nb\\nc\\n" > f; batcat -p -r 2:3 f', { tty: true }).out), 'b\nc\n');
  assert.equal(strip(runScript('printf "x\\n" | batcat --style=header', { tty: true }).out), 'File: STDIN\nx\n');
  assert.equal(runScript('batcat nada 2>&1').out, '[bat error]: \'nada\': No such file or directory (os error 2)\n');
  assert.equal(runScript('batcat --version').out, 'bat 0.25.0\n');
  assert.match(runScript('batcat --list-languages').out, /^Bourne Again Shell \(bash\):sh,bash/m);
  assert.equal(runScript('printf "a b\\tc\\n" > f; batcat -A -p f | cat').out, 'a·b├──┤c␊\n');
});
