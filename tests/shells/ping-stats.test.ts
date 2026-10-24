/** The rtt summary of Linux ping comes from the times it printed (min, avg, max and mdev), as in iputils. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Pc } from '../../src/devices/pc.ts';

function pingFromPc1(command: string): string[] {
  const t = EXAMPLES.find((e) => e.id === 'servidores')?.build();
  assert.ok(t, 'the servidores lab exists');
  return createShell(t.byLabel('PC1') as Pc, 'linux', 'alumno').run(command);
}

const times = (out: readonly string[]): number[] => out.flatMap((l) => /time=([\d.]+) ms/.exec(l)?.[1] ?? []).map(Number);

test('one reply gives the same min, avg and max and a zero mdev', () => {
  const out = pingFromPc1('ping -c 1 192.168.10.2');
  const [t] = times(out);
  assert.equal(out.at(-1), `rtt min/avg/max/mdev = ${t?.toFixed(3)}/${t?.toFixed(3)}/${t?.toFixed(3)}/0.000 ms`);
});

test('several replies: min, avg, max and mdev of the printed times', () => {
  const out = pingFromPc1('ping -c 4 192.168.10.2');
  const ts = times(out);
  assert.equal(ts.length, 4);
  const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
  const mdev = Math.sqrt(ts.reduce((a, b) => a + b * b, 0) / ts.length - avg * avg);
  const fmt = (n: number): string => n.toFixed(3);
  assert.equal(out.at(-1), `rtt min/avg/max/mdev = ${fmt(Math.min(...ts))}/${fmt(avg)}/${fmt(Math.max(...ts))}/${fmt(mdev)} ms`);
});

test('no replies: no rtt line, as iputils', () => {
  const out = pingFromPc1('ping -c 2 192.168.10.99');
  assert.match(out.join('\n'), /2 packets transmitted, 0 received, 100% packet loss/);
  assert.ok(!out.some((l) => l.startsWith('rtt ')));
});
