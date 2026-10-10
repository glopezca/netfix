// Builds dist/ (index.html + ES modules) and dist/netsim.html (single self-contained file).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const jsDir = join(dist, 'js');
const skipTsc = process.argv.includes('--skip-tsc');

if (!skipTsc) {
  rmSync(dist, { recursive: true, force: true });
  execFileSync('tsc', ['-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit', shell: process.platform === 'win32' });
}
mkdirSync(dist, { recursive: true });
copyFileSync(join(root, 'src/ui/index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'src/ui/styles.css'), join(dist, 'styles.css'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\2/g;
const modules = new Map();
for (const file of walk(jsDir)) {
  const path = relative(jsDir, file).split('\\').join('/');
  const source = readFileSync(file, 'utf8');
  const deps = [...source.matchAll(IMPORT_RE)].map((m) => posix.normalize(posix.join(posix.dirname(path), m[3])));
  modules.set(path, { source, deps });
}

// Topological order; a cycle would break the blob-URL loader, so it fails the build.
const order = [];
const state = new Map();
function visit(path, stack) {
  if (state.get(path) === 'done') return;
  if (state.get(path) === 'active') throw new Error(`Import cycle: ${[...stack, path].join(' -> ')}`);
  const mod = modules.get(path);
  if (!mod) throw new Error(`Missing module ${path}`);
  state.set(path, 'active');
  for (const d of mod.deps) visit(d, [...stack, path]);
  state.set(path, 'done');
  order.push(path);
}
const entry = 'ui/main.js';
visit(entry, []);

const loader = `
const sources = ${JSON.stringify(Object.fromEntries(order.map((p) => [p, modules.get(p).source]))).replace(/<\/script/gi, '<\\/script')};
const order = ${JSON.stringify(order)};
const urls = {};
const norm = (base, spec) => { const parts = base.split('/'); parts.pop(); for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); } return parts.join('/'); };
for (const path of order) {
  const code = sources[path].replace(${IMPORT_RE.toString()}, (m, kw, q, spec) => kw + q + urls[norm(path, spec)] + q);
  urls[path] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}
import(urls[${JSON.stringify(entry)}]);
`;

const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const single = readFileSync(join(root, 'src/ui/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/ui/main.js"></script>', () => `<script type="module">${loader}</script>`);
writeFileSync(join(dist, 'netsim.html'), single);
console.log(`Built ${order.length} modules -> dist/index.html, dist/netsim.html (${Math.round(single.length / 1024)} KiB)`);
