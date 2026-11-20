import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassLanState, classLanHost } from '../../src/ui/lan-chooser.ts';
import { takeHostOptions } from '../../src/ui/embed-api.ts';
import type { ClassLanChooser, ClassLanLink } from '../../src/net/classlan.ts';
import { registerClassLanUi } from '../../src/ui/classlan-kind.ts';

registerClassLanUi(); // the host option «classroomLan» (S23: an extension's, ui/host-options.ts)

const mount = {} as HTMLElement;
const link = (lab: number, closed: number[] = []): ClassLanLink => ({ lab, send: () => {}, onMessage: () => () => {}, close: () => { closed.push(lab); } });
const chooserOf = (v: unknown): ClassLanChooser => takeHostOptions(mount, { classroomLan: v }).host.extensions.classroomLan as ClassLanChooser;

test('classroomLan as a chooser: 1-50 classes with id and name, and join()', async () => {
  const c = chooserOf({ classes: [{ id: 'c1', name: '  1º SMR A ' }], join: async () => ({ ...link(4), name: '1º SMR A' }) });
  assert.deepEqual(c.classes, [{ id: 'c1', name: '1º SMR A' }], 'names trimmed');
  assert.equal((await c.join('c1'))?.lab, 4);
  assert.equal(await chooserOf({ classes: [{ id: 'c1', name: 'A' }], join: async () => null }).join('c1'), null);
  await assert.rejects(chooserOf({ classes: [{ id: 'c1', name: 'A' }], join: async () => ({ lab: 0 }) }).join('c1'), /classroomLan/, 'a bad link from join fails like the plain option');
  const many = Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
  for (const bad of [{ classes: [], join: async () => null }, { classes: many, join: async () => null }, { classes: [{ id: '', name: 'A' }], join: async () => null },
    { classes: [{ id: 'c', name: '   ' }], join: async () => null }, { classes: [{ id: 'c', name: 'x'.repeat(81) }], join: async () => null }, { classes: [{ id: 'c', name: 'A' }] }, { classes: 'c1', join: async () => null }]) {
    assert.throws(() => takeHostOptions(mount, { classroomLan: bad }), /classroomLan/);
  }
  assert.throws(() => takeHostOptions(mount, { classroomLan: { ...link(2), close: 'x' } }), /classroomLan/, 'close must be a function');
  assert.equal(typeof takeHostOptions(mount, { classroomLan: link(2) }).host.extensions.classroomLan, 'object');
});

test('a chooser with one class joins it without asking; with two it asks; Cancel joins nothing', async () => {
  const joined: string[] = [];
  const join = async (id: string) => { joined.push(id); return link(joined.length); };
  let asked = 0;
  const one = new ClassLanState({ classes: [{ id: 'a', name: 'A' }], join });
  assert.ok(one.offered && one.needsJoin && one.current === null);
  assert.equal(((await one.join(async () => { asked++; return 'a'; })) as ClassLanLink).lab, 1);
  assert.equal(asked, 0, 'one class: no question');
  assert.equal(one.needsJoin, false);
  const two = new ClassLanState({ classes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], join });
  assert.equal(await two.join(async () => null), 'cancel');
  assert.deepEqual(joined, ['a'], 'cancel joins nothing');
  assert.equal(((await two.join(async (cs) => cs[1]!.id)) as ClassLanLink).lab, 2);
  assert.deepEqual(joined, ['a', 'b']);
});

test('join refused or failing: null, and the next try asks again', async () => {
  const refused = new ClassLanState({ classes: [{ id: 'a', name: 'A' }], join: async () => null });
  assert.equal(await refused.join(async () => 'a'), null);
  assert.equal(refused.needsJoin, true);
  const failing = new ClassLanState({ classes: [{ id: 'a', name: 'A' }], join: async () => { throw new Error('offline'); } });
  assert.equal(await failing.join(async () => 'a'), null);
});

test('deleting the last LAN device calls close(); a chooser asks again, a plain link is gone', async () => {
  const closed: number[] = [];
  const s = new ClassLanState({ classes: [{ id: 'a', name: 'A' }], join: async () => link(7, closed) });
  await s.join(async () => 'a');
  assert.equal(s.track(false), false, 'no device yet: nothing to give back');
  assert.equal(s.track(true), false);
  assert.equal(s.track(true), false);
  assert.equal(s.track(false), true, 'the last device went');
  assert.deepEqual(closed, [7]);
  assert.equal(s.current, null);
  assert.equal(s.needsJoin, true, 're-placing asks and joins again');
  const plain = new ClassLanState(link(3, closed));
  assert.equal(plain.needsJoin, false);
  plain.track(true);
  assert.equal(plain.track(false), true);
  assert.deepEqual(closed, [7, 3]);
  assert.equal(await plain.join(async () => 'x'), null, 'a plain link given back cannot be joined again');
  const keep = new ClassLanState({ lab: 5, send: () => {}, onMessage: () => () => {} });
  keep.track(true);
  assert.equal(keep.track(false), false, 'a plain link without close() stays, as before');
  assert.equal(keep.current?.lab, 5);
});

test('the Classroom LAN as a kind host: offered with the option, joins before the tool, gives the link back', async () => {
  assert.equal(classLanHost(null).offered, false);
  const closed: number[] = [];
  const classes = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const h = classLanHost({ classes, join: async (id) => (id === 'b' ? link(9, closed) : null) }, async () => 'b');
  assert.deepEqual([h.offered, h.context], [true, null]);
  assert.equal(await h.prepare?.(), true);
  assert.equal((h.context as ClassLanLink).lab, 9);
  assert.equal(h.track?.(true), false);
  assert.equal(h.track?.(false), true, 'the last one went: the context changed');
  assert.deepEqual([h.context, closed], [null, [9]]);
  assert.equal(await classLanHost({ classes, join: async () => null }, async () => null).prepare?.(), false, 'cancelled');
  assert.match(String(await classLanHost({ classes, join: async () => null }, async () => 'a').prepare?.()), /./, 'refused: a message');
});
