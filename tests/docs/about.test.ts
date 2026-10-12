/** «Acerca de»: data generated from package.json and LICENSE.md, Markdown parsed into safe blocks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { markdownBlocks, inlineMarkdown } from '../../src/docs/markdown.ts';
import { ABOUT } from '../../src/docs/about-data.ts';
import { aboutInfo } from '../../src/docs/about.ts';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { name: string; version: string; description: string; license: string };

test('about-data.ts is in sync with package.json and LICENSE.md (run npm run about)', () => {
  assert.equal(ABOUT.name, pkg.name);
  assert.equal(ABOUT.version, pkg.version);
  assert.equal(ABOUT.description, pkg.description);
  assert.equal(ABOUT.license, pkg.license);
  assert.equal(ABOUT.repository, 'https://github.com/glopezca/netfix');
  assert.equal(ABOUT.licenseMarkdown, readFileSync(new URL('LICENSE.md', root), 'utf8'));
  const generated = execFileSync(process.execPath, [new URL('scripts/gen-about.mjs', root).pathname, '--stdout'], { encoding: 'utf8' });
  assert.equal(generated, readFileSync(new URL('src/docs/about-data.ts', root), 'utf8'));
});

test('about info: author from LICENSE.md, licences and the rendered sections', () => {
  const info = aboutInfo();
  assert.equal(info.author, 'Germán López Castro');
  assert.equal(info.version, pkg.version);
  assert.ok(info.blocks.some((b) => b.kind === 'table' && b.rows.some((r) => /GPL v3\.0/.test(r[1] ?? ''))));
  assert.ok(info.blocks.some((b) => b.kind === 'h' && /terceros/.test(b.text)));
  assert.ok(info.blocks.some((b) => b.kind === 'code' && /GNU General Public License/.test(b.text)));
});

test('markdown blocks: headings, paragraphs, lists, tables, code and quotes', () => {
  const md = '# Título\n\nUn párrafo\nen dos líneas.\n\n## Sección\n\n- uno\n- **dos**\n\n| A | B |\n|---|---|\n| `x` | y \\| z |\n\n```\ncódigo <b>\n```\n\n> cita\n> larga\n\n### Sub\ntexto';
  assert.deepEqual(markdownBlocks(md), [
    { kind: 'p', text: 'Un párrafo en dos líneas.' },
    { kind: 'h', text: 'Sección' },
    { kind: 'list', items: ['uno', '**dos**'] },
    { kind: 'table', head: ['A', 'B'], rows: [['`x`', 'y | z']] },
    { kind: 'code', text: 'código <b>' },
    { kind: 'note', text: 'cita larga' },
    { kind: 'h', text: 'Sub', level: 4 },
    { kind: 'p', text: 'texto' },
  ]);
});

test('inline markdown: links (http/https and relative to the repository), bold, code; nothing else is markup', () => {
  const base = 'https://github.com/glopezca/netfix/blob/main/';
  assert.deepEqual(inlineMarkdown('Ver [`LICENSE`](LICENSE) y <https://x.org/a> con **negrita**.', base), [
    { text: 'Ver ' }, { text: 'LICENSE', href: `${base}LICENSE`, code: true }, { text: ' y ' }, { text: 'https://x.org/a', href: 'https://x.org/a' },
    { text: ' con ' }, { text: 'negrita', bold: true }, { text: '.' },
  ]);
  assert.deepEqual(inlineMarkdown('[mal](javascript:alert(1)) <img src=x>', base), [{ text: 'mal' }, { text: ' <img src=x>' }]);
  assert.deepEqual(inlineMarkdown('2 * 3 y `a*b`', base), [{ text: '2 * 3 y ' }, { text: 'a*b', code: true }]);
});
