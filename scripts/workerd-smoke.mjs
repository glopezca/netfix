// PR 3.4 (R11, R12): smoke test of the package build in workerd, the Cloudflare Workers runtime. Builds dist/pkg, marks
// the v0.31/v0.46 compat corpus in Node, then runs the same module under `workerd test` and requires an identical result,
// plus fixed es-ES/en-GB Intl output. workerd is not a dependency (P4): set WORKERD_BIN to a pinned binary, as CI does.
import { execFileSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COMPATIBILITY_DATE = '2026-10-16'; // FixITClassroom wrangler.toml
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'node_modules/.cache/workerd-smoke'); // gitignored, removed when the check passes
const bin = process.env.WORKERD_BIN;
if (!bin) {
  process.stderr.write('workerd-smoke: set WORKERD_BIN (npm install --prefix <dir> workerd@<version>; <dir>/node_modules/.bin/workerd)\n');
  process.exit(2);
}

execFileSync('npm', ['run', '--silent', 'build:pkg'], { cwd: root, stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });
cpSync(join(root, 'dist/pkg'), join(work, 'netfix'), { recursive: true, filter: (p) => !p.endsWith('.d.ts') });

const fixtures = [];
for (const v of ['v0.31', 'v0.46']) {
  const dir = join(root, 'tests/fixtures', v);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    fixtures.push({ name: `${v}/${f}`, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) });
  }
}
writeFileSync(join(work, 'fixtures.js'), `export default ${JSON.stringify(fixtures)};\n`);

// Same code in both runtimes. Checklist as tests/phase1/determinism.test.ts: checks that advance simulated time.
writeFileSync(join(work, 'cases.js'), `
import { evaluate, parseChecklist, RUNTIME_INFO } from './netfix/pkg/classroom.js';
import { Topology } from './netfix/pkg/topology.js';
import fixtures from './fixtures.js';

function checklistFor(file) {
  const items = [{ id: 'any', check: { type: 'device', device: file.devices[0]?.label ?? 'none' } }];
  for (const d of file.devices) {
    if (d.kind === 'router') items.push({ id: 'clock-' + d.id, check: { type: 'output', device: d.label, command: 'show clock', contains: '2' } });
    if (d.kind === 'pc') {
      items.push({ id: 'ping-' + d.id, check: { type: 'ping', from: d.label, to: '8.8.8.8' } });
      items.push({ id: 'dns-' + d.id, check: { type: 'dns', from: d.label, name: 'www.google.com' } });
    }
  }
  return parseChecklist(items);
}

export function intl() {
  const month = (l) => new Intl.DateTimeFormat(l, { month: 'long', timeZone: 'UTC' }).format(new Date(0));
  return {
    monthEs: month('es-ES'), monthEn: month('en-GB'),
    numberEs: new Intl.NumberFormat('es-ES').format(12345.6), numberUs: (1234567).toLocaleString('en-US'),
    collateEs: new Intl.Collator('es-ES').compare('ñ', 'o') < 0, localeCompare: 'a'.localeCompare('B') < 0,
  };
}

export function run() {
  const results = fixtures.map(({ name, data }) => {
    const file = Topology.fromJSON(data).toJSON();
    return { name, evaluation: evaluate(file, checklistFor(file)) };
  });
  return { runtime: RUNTIME_INFO, intl: intl(), results };
}
`);

const cases = await import(pathToFileURL(join(work, 'cases.js')).href);
const expected = cases.run();
const intlWanted = { monthEs: 'enero', monthEn: 'January', numberEs: '12.345,6', numberUs: '1,234,567', collateEs: true, localeCompare: true };
const failures = Object.entries(intlWanted).filter(([k, v]) => expected.intl[k] !== v).map(([k, v]) => `Node Intl ${k}: ${expected.intl[k]} != ${v}`);
writeFileSync(join(work, 'expected.js'), `export default ${JSON.stringify({ ...expected, intl: intlWanted })};\n`);

writeFileSync(join(work, 'main.js'), `
import { run } from './cases.js';
import expected from './expected.js';
export default {
  async test() {
    const got = run();
    const diff = [];
    if (JSON.stringify(got.intl) !== JSON.stringify(expected.intl)) diff.push('intl: ' + JSON.stringify(got.intl));
    if (JSON.stringify(got.runtime) !== JSON.stringify(expected.runtime)) diff.push('runtime: ' + JSON.stringify(got.runtime));
    if (got.results.length !== expected.results.length) diff.push('result count ' + got.results.length);
    got.results.forEach((r, i) => {
      if (JSON.stringify(r) !== JSON.stringify(expected.results[i])) diff.push('differs from Node: ' + r.name);
    });
    if (diff.length) throw new Error(diff.join('\\n'));
  },
};
`);

const modules = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) modules.push(relative(work, p));
  }
};
walk(work);
// The first module is the Worker's entry point.
modules.sort((a, b) => (a === 'main.js' ? -1 : b === 'main.js' ? 1 : a.localeCompare(b)));
writeFileSync(join(work, 'config.capnp'), `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (services = [(name = "main", worker = .smoke)]);
const smoke :Workerd.Worker = (
  modules = [
${modules.map((m) => `    (name = "${m}", esModule = embed "${m}")`).join(',\n')}
  ],
  compatibilityDate = "${COMPATIBILITY_DATE}",
);
`);

try {
  execFileSync(bin, ['test', 'config.capnp'], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  failures.push(`workerd test:\n${e.stdout ?? ''}${e.stderr ?? e.message}`);
}
if (failures.length) {
  process.stderr.write(`workerd-smoke: FAILED; files kept in ${work}\n${failures.join('\n')}\n`);
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
process.stdout.write(`workerd-smoke: ${expected.results.length} fixtures and Intl identical in Node and workerd (${COMPATIBILITY_DATE})\n`);
