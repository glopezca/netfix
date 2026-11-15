// PR 3.3: checks the published package as a consumer sees it. Runs `npm pack` (prepack builds dist/pkg), installs the
// tarball into a throwaway consumer and checks: tarball contents, runtime imports in Node, closed internal paths, and
// that the .d.ts type-check under NodeNext with skipLibCheck off (ES2022 without DOM for topology/classroom, DOM for ui).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'node_modules/.cache/pack-check'); // gitignored, removed when the check passes
const consumer = join(work, 'consumer');
const pkgDir = join(consumer, 'node_modules/@glopezca/netfix');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

rmSync(work, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });

// 1. Pack and list the tarball.
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], root));
const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]; // npm 10: array; npm 11: keyed by name
const tarball = join(work, filename);
const entries = run('tar', ['-tzf', tarball]).split('\n').filter(Boolean).map((e) => e.replace(/^package\//, ''));
const files = new Set(entries);

for (const [sub, target] of Object.entries(pkg.exports)) {
  for (const t of typeof target === 'string' ? [target] : Object.values(target)) {
    const rel = t.replace(/^\.\//, '');
    if (rel.includes('*')) {
      const re = new RegExp(`^${rel.replace(/[.]/g, '\\.').replace('*', '[^/]+')}$`);
      check(entries.some((e) => re.test(e)), `exports["${sub}"] pattern ${t} matches nothing in the tarball`);
    } else check(files.has(rel), `exports["${sub}"] target ${t} is missing from the tarball`);
  }
}
const leaked = entries.filter((e) => /\.ts$/.test(e) && !e.endsWith('.d.ts'));
check(leaked.length === 0, `TypeScript sources in the tarball: ${leaked.slice(0, 5).join(', ')}`);
const stray = entries.filter((e) => /^(tests|scripts|site|docs|\.github)\//.test(e));
check(stray.length === 0, `Unexpected files in the tarball: ${stray.slice(0, 5).join(', ')}`);

// 2. Install into a consumer (extract, as npm would; the package has no dependencies).
run('tar', ['-xzf', tarball, '-C', pkgDir, '--strip-components=1']);
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));

// 3. Runtime: topology/classroom load in Node; ui and assets resolve; internal paths are closed.
writeFileSync(join(consumer, 'runtime.mjs'), `
import assert from 'node:assert/strict';
const topo = await import('@glopezca/netfix/topology');
const cls = await import('@glopezca/netfix/classroom');
assert.equal(typeof topo.Topology, 'function');
assert.equal(typeof topo.validateFile, 'function');
assert.equal(typeof cls.evaluate, 'function');
assert.equal(typeof cls.evaluateFile, 'function');
assert.ok(new cls.WorkLimitError() instanceof Error);
for (const p of ['@glopezca/netfix/ui', '@glopezca/netfix/ui/styles.css', '@glopezca/netfix/ui/favicon.png', '@glopezca/netfix/package.json']) import.meta.resolve(p);
for (const p of ['@glopezca/netfix', '@glopezca/netfix/dist/pkg/net/network.js', '@glopezca/netfix/src/ui/main.ts']) {
  assert.throws(() => import.meta.resolve(p), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, p);
}
`);
try { run(process.execPath, ['runtime.mjs'], consumer); } catch (e) { failures.push(`runtime: ${e.stderr || e.message}`); }

// 4. Types: strict NodeNext consumer, no lib check skipping, no ambient @types.
const tsconfig = (lib, file) => JSON.stringify({
  compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib, strict: true,
    skipLibCheck: false, noEmit: true, types: [] },
  files: [file],
});
writeFileSync(join(consumer, 'core.ts'), `
import { Topology, validateFile, TopologyFileError, type TopologyFile } from '@glopezca/netfix/topology';
import { evaluate, parseChecklist, WorkLimitError, type Evaluation } from '@glopezca/netfix/classroom';
export const used: unknown[] = [Topology, validateFile, TopologyFileError, evaluate, parseChecklist, WorkLimitError];
export type Used = [TopologyFile, Evaluation];
`);
writeFileSync(join(consumer, 'ui.ts'), `
import '@glopezca/netfix/ui';
import type { NetfixApi, EmbedHandle } from '@glopezca/netfix/ui';
export type Used = [NetfixApi, EmbedHandle];
`);
writeFileSync(join(consumer, 'tsconfig.core.json'), tsconfig(['ES2022'], 'core.ts'));
writeFileSync(join(consumer, 'tsconfig.ui.json'), tsconfig(['ES2022', 'DOM'], 'ui.ts'));
for (const p of ['tsconfig.core.json', 'tsconfig.ui.json']) {
  try { run(process.execPath, [tsc, '-p', p], consumer); } catch (e) { failures.push(`tsc ${p}:\n${e.stdout || e.message}`); }
}

if (failures.length) {
  process.stderr.write(`pack-check: ${failures.length} failure(s); consumer kept in ${consumer}\n${failures.join('\n')}\n`);
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
process.stdout.write(`pack-check: ${filename} OK (${entries.length} files, ${entries.filter((e) => e.endsWith('.d.ts')).length} .d.ts)\n`);
