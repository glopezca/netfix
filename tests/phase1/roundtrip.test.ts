/** Characterization: fromJSON -> toJSON -> fromJSON is stable over every lab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';

test('toJSON(fromJSON(file)) is a fixed point for every EXAMPLES lab', () => {
  for (const ex of EXAMPLES) {
    const once = Topology.fromJSON(ex.build().toJSON()).toJSON();
    assert.deepEqual(Topology.fromJSON(once).toJSON(), once, ex.id);
  }
});

// 0.31.0 fixtures (what Classroom saves today) are not produced here: no honest way without building v0.31.0 from git.
