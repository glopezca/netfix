/** Zoom and pan geometry of the workspace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, zoomAt, toWorld, fitBox, boundsOf, pinchScale, placeInside, MIN_SCALE, MAX_SCALE } from '../../src/ui/viewport-math.ts';

test('scale stays within limits and rejects NaN', () => {
  assert.equal(clampScale(10), MAX_SCALE);
  assert.equal(clampScale(0), MIN_SCALE);
  assert.equal(clampScale(Number.NaN), 1);
  assert.equal(clampScale(1.2), 1.2);
});

test('zooming keeps the world point under the finger', () => {
  const scroll = { left: 100, top: 50 };
  const at = { x: 200, y: 120 };
  const before = toWorld(1, at, scroll);
  const next = zoomAt(1, 2, at, scroll);
  const after = toWorld(2, at, next);
  assert.deepEqual(after, before);
  assert.deepEqual(zoomAt(2, 0.5, { x: 0, y: 0 }, { left: 0, top: 0 }), { left: 0, top: 0 }, 'never negative');
});

test('fit shows all devices centred and never zooms in beyond 1.5', () => {
  const box = boundsOf([{ x: 200, y: 100 }, { x: 800, y: 500 }]);
  assert.deepEqual(box, { minX: 200, minY: 100, maxX: 800, maxY: 500 });
  const fit = fitBox(box, 400, 300);
  assert.ok(fit.scale < 1 && fit.scale >= MIN_SCALE);
  const centre = toWorld(fit.scale, { x: 200, y: 150 }, fit.scroll);
  assert.ok(Math.abs(centre.x - 500) < 1 && Math.abs(centre.y - 300) < 1);
  assert.equal(fitBox(boundsOf([{ x: 10, y: 10 }]), 2000, 2000).scale, 1.5);
  assert.deepEqual(fitBox(null, 100, 100), { scale: 1, scroll: { left: 0, top: 0 } });
});

test('pinch scales by the ratio of distances; menus stay inside', () => {
  assert.equal(pinchScale(1, 100, 200), 2);
  assert.equal(pinchScale(1, 0, 200), 1);
  assert.deepEqual(placeInside(380, 290, 100, 80, 400, 300), { x: 292, y: 212 });
  assert.deepEqual(placeInside(-5, -5, 100, 80, 400, 300), { x: 8, y: 8 });
});
