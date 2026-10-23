/** Resizing a drawing by its handles: corners and edge midpoints of an area, the two ends of a line. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAnnotation } from '../../src/net/annotations.ts';
import { handlesOf, resizeAnnotation, MIN_BOX } from '../../src/net/annotation-resize.ts';

const area = makeAnnotation('a1', { kind: 'rect', points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], color: '#388e3c', fill: true, width: 2, text: 'LAN', size: 14 });

test('an area has eight handles (corners and midpoints), a line its two ends, a text none', () => {
  assert.deepEqual(handlesOf(area).map((h) => `${h.handle}@${h.x},${h.y}`), ['nw@100,100', 'n@200,100', 'ne@300,100', 'e@300,150', 'se@300,200', 's@200,200', 'sw@100,200', 'w@100,150']);
  const line = makeAnnotation('l1', { kind: 'line', points: [{ x: 0, y: 0 }, { x: 50, y: 80 }], color: '#000000', fill: false, width: 2 });
  assert.deepEqual(handlesOf(line).map((h) => h.handle), ['p0', 'p1']);
  assert.deepEqual(handlesOf(makeAnnotation('t1', { kind: 'text', points: [{ x: 0, y: 0 }], color: '#000000', fill: false, width: 1, text: 'hola' })), []);
});

test('a corner moves two sides, a midpoint one; the opposite side stays; style and name are kept', () => {
  const se = resizeAnnotation(area, 'se', 40, 30);
  assert.deepEqual(se.points, [{ x: 100, y: 100 }, { x: 340, y: 230 }]);
  assert.equal(se.text, 'LAN');
  assert.equal(se.fill, true);
  assert.deepEqual(resizeAnnotation(area, 'n', 999, -20).points, [{ x: 100, y: 80 }, { x: 300, y: 200 }], 'n moves only the top');
  assert.deepEqual(resizeAnnotation(area, 'w', 50, 999).points, [{ x: 150, y: 100 }, { x: 300, y: 200 }]);
  assert.deepEqual(resizeAnnotation(area, 'nw', -10, -10).points, [{ x: 90, y: 90 }, { x: 300, y: 200 }]);
});

test('it never flips nor goes below the minimum size; a line end moves alone', () => {
  const tiny = resizeAnnotation(area, 'e', -500, 0);
  assert.equal((tiny.points[1]?.x ?? 0) - (tiny.points[0]?.x ?? 0), MIN_BOX);
  const flat = resizeAnnotation(area, 'n', 0, 500);
  assert.equal((flat.points[1]?.y ?? 0) - (flat.points[0]?.y ?? 0), MIN_BOX);
  const line = makeAnnotation('l1', { kind: 'line', points: [{ x: 0, y: 0 }, { x: 50, y: 80 }], color: '#000000', fill: false, width: 2 });
  assert.deepEqual(resizeAnnotation(line, 'p1', 10, -5).points, [{ x: 0, y: 0 }, { x: 60, y: 75 }]);
});
