/** Where the link light and the interface name go on a cable: just past the device's drawing, on the cable. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cableMarks, rayExit } from '../../src/ui/canvas-geometry.ts';

const icon = { x0: -30, x1: 30, y0: -40, y1: 30 };
const caption = { x0: -55, x1: 55, y0: 30, y1: 62 };

test('a ray leaves a rectangle where its sides say; one that misses it gives 0', () => {
  assert.equal(rayExit(1, 0, icon), 30);
  assert.equal(rayExit(0, 1, icon), 30);
  assert.equal(rayExit(0, -1, icon), 40);
  assert.equal(rayExit(0, -1, caption), 0, 'the caption is below');
  assert.equal(rayExit(0, 1, caption), 62);
});

test('the name goes past the name and addresses below the device, centred on the cable', () => {
  const label = { halfW: 18, halfH: 6 };
  const down = cableMarks({ x: 0, y: 0 }, { x: 0, y: 300 }, [icon, caption], label);
  assert.ok(down.light > 62 && down.label > down.light + 6, JSON.stringify(down));
  const right = cableMarks({ x: 0, y: 0 }, { x: 300, y: 0 }, [icon, caption], label);
  assert.ok(right.light > 30 && right.light < 45, 'sideways the caption is not in the way');
  assert.ok(right.label - right.light >= 18, 'room for half the name');
  const diagonal = cableMarks({ x: 0, y: 0 }, { x: -200, y: 200 }, [icon, caption], label);
  assert.ok(diagonal.light > Math.hypot(30, 30), 'past the corner of the caption');
});
