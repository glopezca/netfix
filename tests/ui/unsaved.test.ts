/** Unsaved changes: the workspace fingerprint against the one saved or loaded last. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { SavedState, fingerprint } from '../../src/ui/workspace-store.ts';

function memory(): { get: (k: string) => string | null; set: (k: string, v: string) => void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, data };
}

test('a lab just loaded is clean; adding a device makes it dirty; saving makes it clean again', () => {
  const store = memory();
  const saved = new SavedState(store);
  const topo = EXAMPLES[0]!.build();
  saved.mark(topo);
  assert.equal(saved.dirty(topo), false);
  topo.add('pc', 10, 10);
  assert.equal(saved.dirty(topo), true);
  saved.mark(topo);
  assert.equal(saved.dirty(topo), false);
});

test('the mark is kept in the store: a new instance (reload, change of language) still knows it', () => {
  const store = memory();
  const topo = EXAMPLES[0]!.build();
  new SavedState(store).mark(topo);
  topo.add('switch', 0, 0);
  assert.equal(new SavedState(store).dirty(topo), true);
});

test('with no mark stored yet (first run after the update), the restored workspace counts as saved', () => {
  const store = memory();
  const topo = new Topology();
  const saved = new SavedState(store);
  saved.adopt(topo);
  assert.equal(saved.dirty(topo), false);
  assert.ok(store.data.size > 0);
});

test('time passing does not change the fingerprint of any lab (DHCP, keepalives, timers)', () => {
  for (const ex of EXAMPLES) {
    const topo = ex.build();
    const before = fingerprint(topo);
    topo.net.runFor(10 * 60_000);
    assert.equal(fingerprint(topo), before, ex.id);
  }
});

test('the blank workspace is no longer a lab: Nuevo does the same', () => {
  assert.equal(EXAMPLES.find((e) => e.id === 'blanco'), undefined);
});

test('saving and loading a lab gives the same fingerprint (a reload does not look like a change)', () => {
  for (const ex of EXAMPLES) {
    const topo = ex.build();
    const again = Topology.fromJSON(JSON.parse(JSON.stringify(topo.toJSON())));
    assert.equal(fingerprint(again), fingerprint(topo), ex.id);
  }
});

test('without an autosave, the first lab is the clean state even if an old mark is stored', async () => {
  const { initialWorkspace } = await import('../../src/ui/workspace-store.ts');
  const store = memory();
  store.set('netfix:workspace-saved:v1', 'stale');
  const saved = new SavedState(store);
  const topo = initialWorkspace(store, saved, () => EXAMPLES[0]!.build());
  assert.equal(saved.dirty(topo), false);
});
