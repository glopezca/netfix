/** The date and time stamped prompt is a global setting (off by default), no longer one of each device or network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setGlobalTimestampPrompt, timestampPromptOn } from '../../src/shells/prompt-clock.ts';
import type { Pc } from '../../src/devices/pc.ts';

test('off by default; turning it on reaches every terminal of every device', () => {
  const t = EXAMPLES.find((e) => e.id === 'servidores')!.build();
  const pc = t.byLabel('PC1') as Pc;
  assert.equal(timestampPromptOn(pc), false);
  setGlobalTimestampPrompt(true);
  try {
    assert.match(createShell(pc, 'linux').prompt(), /\d{2}:\d{2} /);
    assert.equal(timestampPromptOn(t.byLabel('PC0') as Pc), true);
  } finally {
    setGlobalTimestampPrompt(false);
  }
});

test('it is not saved with the network, and an old file that had it opens without it', () => {
  const t = EXAMPLES.find((e) => e.id === 'servidores')!.build();
  const file = t.toJSON();
  assert.ok(!JSON.stringify(file).includes('timestampPrompt'));
  const old = { ...file, devices: file.devices.map((d) => (d.pc ? { ...d, pc: { ...d.pc, timestampPrompt: true } } : d)) };
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(old)));
  assert.equal(timestampPromptOn(again.byLabel('PC1') as Pc), false);
});
