/** Options of netfix.embed (untrusted, from the host page) and netfix.evaluate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMount, embedSession, evaluateFile, STANDALONE } from '../../src/classroom/embed.ts';
import { EXAMPLES } from '../../src/net/examples.ts';

test('embedded: restrictions validated, the starting topology loaded and no browser autosave', () => {
  const file = EXAMPLES[0]!.build().toJSON();
  const changes: unknown[] = [];
  const { session, topology } = embedSession({ topology: file, restrictions: { docs: false }, onChange: (f: unknown) => changes.push(f) });
  assert.equal(session.embedded, true);
  assert.equal(session.policy.docs, false);
  assert.equal(topology.placed.size, file.devices.length);
  session.onChange?.(topology.toJSON());
  assert.equal(changes.length, 1);
  assert.equal(STANDALONE.embedded, false);
  assert.equal(embedSession(undefined).topology.placed.size, 0, 'no topology starts an empty workspace');
});

test('bad options are rejected before anything starts', () => {
  assert.throws(() => embedSession('x'), /objeto/);
  assert.throws(() => embedSession({ onChange: 'alert(1)' }), /función/);
  assert.throws(() => embedSession({ autosave: true }), /desconocida/);
  assert.throws(() => embedSession({ restrictions: { labs: 'all' } }), /Restricciones/);
  assert.throws(() => embedSession({ topology: { format: 'otro' } }));
});

test('netfix.evaluate validates the checklist and marks the file', () => {
  const file = EXAMPLES[0]!.build().toJSON();
  const r = evaluateFile(file, [{ id: 'pc', check: { type: 'device', device: 'PC0', kind: 'pc' } }]);
  assert.deepEqual([r.score, r.max], [1, 1]);
  assert.throws(() => evaluateFile(file, [{ id: 'pc' }]), /comprobación/);
});

test('netfix.embed needs an element to mount on', () => {
  assert.throws(() => checkMount('#app'), /elemento/);
  assert.throws(() => checkMount(undefined), /elemento/);
});
