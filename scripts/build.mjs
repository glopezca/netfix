// Builds dist/ (index.html + ES modules) and dist/netfix.html (single self-contained file).
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
copyFileSync(join(root, 'src/ui/web-admin.css'), join(dist, 'web-admin.css'));
// Favicon (the N isotype) and the home-screen icon, declared in the HTML so they show before any script runs.
const ICONS = ['favicon.png', 'apple-touch-icon.png'];
for (const f of ICONS) copyFileSync(join(root, 'assets/brand', f), join(dist, f));
const dataUri = (f) => `data:image/png;base64,${readFileSync(join(root, 'assets/brand', f)).toString('base64')}`;

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

// Classic-script bundle: each module becomes a function scope, run in dependency order.
function transform(path, source) {
  const exported = [];
  let code = source.replace(/^import \{([^}]*)\} from (['"])([^'"]+)\2;?[ \t]*$/gm, (m, names, q, spec) => {
    const target = posix.normalize(posix.join(posix.dirname(path), spec));
    return `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = __m[${JSON.stringify(target)}];`;
  });
  code = code.replace(/^export \{([^}]*)\};?[ \t]*$/gm, (m, names) => {
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, as] = n.split(/\s+as\s+/);
      exported.push(as ? `${as}: ${local}` : local);
    }
    return '';
  });
  code = code.replace(/^export ((?:async )?(?:function\*?|class|const|let|var) (\w+))/gm, (m, decl, name) => {
    exported.push(name);
    return decl;
  });
  if (/^(import|export)\s+[{*\w]/m.test(code)) throw new Error(`Unsupported import/export form in ${path}`);
  return `__m[${JSON.stringify(path)}] = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`;
}
const bundle = `(() => {\n"use strict";\nconst __m = {};\n${order.map((p) => transform(p, modules.get(p).source)).join('\n')}\n})();`;
writeFileSync(join(dist, 'netfix.bundle.js'), bundle);
const inlineScript = bundle.replace(/<\/script/gi, '<\\/script');

const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const webCss = readFileSync(join(root, 'src/ui/web-admin.css'), 'utf8');
const single = readFileSync(join(root, 'src/ui/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<link rel="stylesheet" href="web-admin.css">', () => `<style>\n${webCss}\n</style>`)
  .replace('<script type="module" src="js/ui/main.js"></script>', () => `<script>${inlineScript}</script>`)
  .replace('href="favicon.png"', () => `href="${dataUri('favicon.png')}"`)
  .replace('href="apple-touch-icon.png"', () => `href="${dataUri('apple-touch-icon.png')}"`);
writeFileSync(join(dist, 'netfix.html'), single);
// Committed standalone page (served online via raw.githack.com, also opens from file://).
mkdirSync(join(root, 'demo'), { recursive: true });
writeFileSync(join(root, 'demo', 'netfix-lab.html'), single.replace('<title>Netfix — laboratorio de redes</title>', '<title>Netfix Lab</title>'));

// Artifact variant: no document skeleton, title first, embed flag for in-page saving.
const artifact = single
  .replace(/^[\s\S]*?<title>/, '<title>')
  .replace('<title>Netfix — laboratorio de redes</title>', '<title>Netfix Lab</title>')
  .replace(/<\/head>\s*<body data-mode="realtime">/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '')
  .replace('<div id="app"></div>', '<div id="app" data-embed="artifact"></div>');
writeFileSync(join(dist, 'artifact.html'), artifact);
console.log(`Built ${order.length} modules -> dist/index.html, dist/netfix.html (${Math.round(single.length / 1024)} KiB), dist/artifact.html`);
