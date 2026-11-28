/** Brand marks on the device icons (0.98.0): what each device runs, as simplified look-alikes, or none. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markOf, withMark } from '../../src/ui/device-marks.ts';

test('each device gets the mark of what it runs; a MultiOS PC and the setting «none» get none', () => {
  const windows = markOf('pc', 'windows', 'ubuntu');
  const ubuntuPc = markOf('pc', 'linux', 'ubuntu');
  const tuxPc = markOf('pc', 'linux', 'tux');
  assert.equal((windows.match(/<rect/g) ?? []).length, 4, 'four panes');
  assert.match(ubuntuPc, /<circle[^>]*fill="none"/, 'a ring');
  assert.equal((ubuntuPc.match(/<circle/g) ?? []).length, 4, 'and three dots');
  assert.match(tuxPc, /<ellipse/, 'a penguin\'s head');
  assert.match(windows + ubuntuPc, /var\(--dev-logo, var\(--dev-top\)\)/, 'on the screen: a colour an outline style can change');
  assert.equal(markOf('pc', 'both', 'ubuntu'), '', 'a MultiOS PC: no brand');
  assert.match(markOf('server', 'linux', 'ubuntu'), /var\(--dev-mark\)/, 'a server: on its front');
  assert.match(markOf('server', 'windows', 'tux'), /<rect/, 'a Windows server: the window');
  assert.match(markOf('linuxrouter', undefined, 'tux'), /<ellipse/, 'a GNU/Linux router: Tux on its front face');
  assert.match(markOf('router', undefined, 'ubuntu'), /<path d="M/, 'an IOS router: the bars');
  assert.match(markOf('switch', undefined, 'tux'), /<path d="M/, 'a switch too');
  assert.equal(markOf('cloud', undefined, 'ubuntu'), '');
  for (const kind of ['pc', 'server', 'router', 'linuxrouter', 'switch'] as const) assert.equal(markOf(kind, 'linux', 'none'), '', `${kind}: none`);
  assert.match(withMark('<svg><rect/></svg>', '<circle/>'), /<rect\/>\s*<g class="dev-brand"><circle\/><\/g>\s*<\/svg>$/, 'drawn last, over the icon');
  assert.equal(withMark('<svg/>', ''), '<svg/>');
});
