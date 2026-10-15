/** Drawings of the workspace: areas, lines, freehand strokes and labels (pure model, JSON and topology). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationsFromJson, boundsOf, BASIC_COLORS, makeAnnotation, moveAnnotation, normaliseColor, simplifyStroke, MAX_ANNOTATIONS,
} from '../../src/net/annotations.ts';
import { Topology } from '../../src/net/topology.ts';

test('colours: basic palette and any #rrggbb', () => {
  assert.ok(BASIC_COLORS.length >= 8);
  assert.equal(normaliseColor('#1A2b3C'), '#1a2b3c');
  assert.equal(normaliseColor('#abc'), '#aabbcc');
  assert.equal(normaliseColor('red'), null);
  assert.equal(normaliseColor('#12345g'), null);
});

test('shapes are immutable records; moving returns a new one', () => {
  const a = makeAnnotation('a1', { kind: 'rect', points: [{ x: 10, y: 20 }, { x: 110, y: 80 }], color: '#1976d2', fill: true, width: 2, text: 'LAN · 192.168.1.0/24' });
  const b = moveAnnotation(a, 5, -5);
  assert.deepEqual(a.points[0], { x: 10, y: 20 });
  assert.deepEqual(b.points, [{ x: 15, y: 15 }, { x: 115, y: 75 }]);
  assert.deepEqual(boundsOf(b), { x: 15, y: 15, w: 100, h: 60 });
  // Corners in any order give the same box.
  assert.deepEqual(boundsOf(makeAnnotation('a2', { kind: 'ellipse', points: [{ x: 50, y: 50 }, { x: 0, y: 10 }], color: '#000000', fill: false, width: 1 })), { x: 0, y: 10, w: 50, h: 40 });
});

test('freehand strokes drop points closer than the threshold and are capped', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => ({ x: i * 0.5, y: 0 }));
  const s = simplifyStroke(pts);
  assert.ok(s.length < 2100 && s.length > 1);
  assert.deepEqual(s[0], { x: 0, y: 0 });
});

test('JSON is validated: a bad list refuses the file, a bad drawing is just left out', () => {
  const ok = [{ id: 'a1', kind: 'text', points: [{ x: 1, y: 2 }], color: '#ff0000', fill: false, width: 1, text: 'DMZ', size: 16 }];
  assert.equal(annotationsFromJson(ok).length, 1);
  assert.deepEqual(annotationsFromJson(undefined), []);
  for (const bad of ['nope', { 0: ok[0] }, Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, i) => ({ ...ok[0], id: `a${i}` }))]) assert.throws(() => annotationsFromJson(bad));
  for (const bad of [
    { ...ok[0], kind: 'script' }, { ...ok[0], color: 'javascript:' }, { ...ok[0], points: [] }, { ...ok[0], text: 'x'.repeat(500) },
    { ...ok[0], points: [{ x: Number.NaN, y: 0 }] }, { ...ok[0], id: '<img>' }, { ...ok[0], text: '' }, null,
    { id: 'a9', kind: 'free', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: '#000000', fill: false, width: 1 },
  ]) assert.deepEqual(annotationsFromJson([bad, ...ok]).map((a) => a.id), ['a1'], JSON.stringify(bad));
  assert.equal(annotationsFromJson([...ok, ...ok]).length, 1, 'repeated ids are dropped');
});

test('the topology keeps its drawings and saves them in the file', () => {
  const t = new Topology();
  const a = t.addAnnotation({ kind: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], color: '#388e3c', fill: true, width: 2, text: 'Red privada' });
  assert.ok(a);
  t.updateAnnotation(a.id, (x) => moveAnnotation(x, 10, 10));
  t.addAnnotation({ kind: 'free', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], color: '#000000', fill: false, width: 3 });
  const file = t.toJSON();
  assert.equal(file.annotations?.length, 2);
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(back.annotations, t.annotations);
  back.removeAnnotation(a.id);
  // A freehand «dot» (points closer than the simplification step) is not kept.
  assert.equal(back.addAnnotation({ kind: 'free', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000000', fill: false, width: 1 }), undefined);
  assert.equal(back.annotations.length, 1);
  // A new drawing never reuses an id from the file.
  assert.notEqual(back.addAnnotation({ kind: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000000', fill: false, width: 1 })?.id, back.annotations[0]?.id);
  // Files without drawings (older versions) still open.
  const { annotations: _omit, ...old } = file;
  assert.deepEqual(Topology.fromJSON(JSON.parse(JSON.stringify(old))).annotations, []);
});
