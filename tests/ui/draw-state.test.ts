/** Drawing bar state: style and the selected drawing (the bar's Delete drawing button follows it). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrawState } from '../../src/ui/draw-bar.ts';

test('the selected drawing is announced to the bar, without repeating the same one', () => {
  const s = new DrawState();
  const seen: (string | null)[] = [];
  s.onSelect((id) => seen.push(id));
  s.select('a1');
  s.select('a1');
  s.select(null);
  assert.deepEqual(seen, ['a1', null]);
  assert.equal(s.selected, null);
});
