// Builds the GitHub Pages site in _site/: the landing page in British English (root) and Spanish (es/),
// its images, and the app itself in app/ (run `npm run build` first so dist/ exists).
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, LOCALES } from './site-render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const out = join(root, '_site');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'netfix.html'))) throw new Error('dist/ is missing: run npm run build first');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const template = readFileSync(join(site, 'index.template.html'), 'utf8');
for (const [lang, loc] of Object.entries(LOCALES)) {
  const strings = JSON.parse(readFileSync(join(site, 'i18n', `${lang}.json`), 'utf8'));
  mkdirSync(join(out, loc.dir), { recursive: true });
  writeFileSync(join(out, loc.dir, 'index.html'), renderPage(template, strings, lang));
}
copyFileSync(join(site, 'site.css'), join(out, 'site.css'));
cpSync(join(site, 'img'), join(out, 'img'), { recursive: true });
for (const f of ['logo.webp', 'isologo-n.webp', 'favicon.png', 'apple-touch-icon.png']) copyFileSync(join(root, 'assets/brand', f), join(out, f));
cpSync(dist, join(out, 'app'), { recursive: true });
// GitHub Pages must serve the files as they are (no Jekyll).
writeFileSync(join(out, '.nojekyll'), '');
process.stdout.write(`Site -> _site/ (${Object.keys(LOCALES).join(', ')}, app/)\n`);
