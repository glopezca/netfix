/** Labs saved by Netfix 0.31 (what Classroom stores today) and 0.46 still load, mark and re-save stably. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Topology } from '../../src/net/topology.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Pc } from '../../src/devices/pc.ts';

const dir = (v: string): URL => new URL(`../fixtures/${v}/`, import.meta.url);
const fixture = (v: string, f: string): unknown => JSON.parse(readFileSync(new URL(f, dir(v)), 'utf8'));

for (const v of ['v0.31', 'v0.46']) {
  test(`every ${v} fixture loads, marks and reaches a fixed point after one load`, () => {
    const files = readdirSync(dir(v)).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 17, `${v}: ${files.length} fixtures`);
    for (const f of files) {
      const data = fixture(v, f);
      const once = Topology.fromJSON(data).toJSON();
      assert.deepEqual(Topology.fromJSON(once).toJSON(), once, `${v}/${f}`);
      assert.equal(evaluate(data, []).max, 0, `${v}/${f}`);
    }
  });
}

test('a v0.46 Windows hosts file at /Windows moves to C:\\ when the terminal opens', () => {
  const pc = Topology.fromJSON(fixture('v0.46', 'hosts-legacy.json')).byLabel('PC0') as Pc;
  const out = createShell(pc, 'windows').run('type C:\\Windows\\System32\\drivers\\etc\\hosts').join('\n');
  assert.match(out, /^10\.0\.0\.7 impresora/m);
});
