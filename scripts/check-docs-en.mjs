// Compares a Spanish docs module with its English translation: same exports, page ids, block kinds,
// code blocks with the same number of lines and the same first word per line, same table shapes and
// the same keys in record exports. Usage: node scripts/check-docs-en.mjs ios [linux …]
const pick = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' && 'pages' in v ? v.pages : null);
let bad = 0;
const fail = (m) => { bad++; console.error(m); };
function blocks(file, page, es, en) {
  if (es.length !== en.length) return fail(`${file} ${page}: ${es.length} blocks vs ${en.length}`);
  es.forEach((b, i) => {
    const e = en[i];
    if (b.kind !== e.kind) return fail(`${file} ${page} block ${i}: ${b.kind} vs ${e.kind}`);
    if (b.kind === 'code') {
      const a = b.text.split('\n'); const c = e.text.split('\n');
      if (a.length !== c.length) return fail(`${file} ${page} code ${i}: ${a.length} lines vs ${c.length}`);
      a.forEach((l, j) => { const w = (s) => s.trim().split(/\s+/)[0] ?? ''; if (w(l) !== w(c[j])) fail(`${file} ${page} code ${i} line ${j}: «${w(l)}» vs «${w(c[j])}»`); });
    }
    if (b.kind === 'table' && (b.head.length !== e.head.length || b.rows.length !== e.rows.length)) fail(`${file} ${page} table ${i}: shape differs`);
    if (b.kind === 'list' && b.items.length !== e.items.length) fail(`${file} ${page} list ${i}: ${b.items.length} items vs ${e.items.length}`);
  });
}
for (const name of process.argv.slice(2)) {
  const es = await import(`../src/docs/${name}.ts`);
  const en = await import(`../src/docs/en/${name}.ts`);
  for (const [key, val] of Object.entries(es)) {
    if (!(key in en)) { fail(`${name}: export ${key} missing`); continue; }
    const a = pick(val); const b = pick(en[key]);
    if (a && b) {
      if (a.map((p) => p.id).join() !== b.map((p) => p.id).join()) fail(`${name} ${key}: page ids differ`);
      a.forEach((p, i) => b[i] && blocks(name, p.id, p.blocks, b[i].blocks));
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const ka = Object.keys(val).sort().join(); const kb = Object.keys(en[key]).sort().join();
      if (ka !== kb) fail(`${name} ${key}: keys differ`);
    } else if (Array.isArray(val) && val.length !== en[key].length) fail(`${name} ${key}: length differs`);
  }
}
console.log(bad ? `${bad} problem(s)` : 'ok');
process.exit(bad ? 1 : 0);
