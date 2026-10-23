/**
 * The labs keep their labels apart: no cable-end label (interface name and addresses) over another one, over a
 * device's drawing (icon, model, name and caption) or over the name of an area. Same geometry as the workspace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import type { Placed, Topology } from '../../src/net/topology.ts';
import { endLabel } from '../../src/ui/link-labels.ts';
import type { Box } from '../../src/ui/link-labels.ts';
import { deviceShapes } from '../../src/ui/device-caption.ts';

const AREA_CHAR = 7.6;
const AREA_PAD = 8;

/** A little margin, as the real text may be a few pixels wider than the estimate (the e2e measures it). */
const MARGIN = 2;
const hit = (a: Box, b: Box): boolean => a.x0 - MARGIN < b.x1 && b.x0 - MARGIN < a.x1 && a.y0 - MARGIN < b.y1 && b.y0 - MARGIN < a.y1;

function boxes(topo: Topology): { ends: { box: Box; what: string }[]; devices: { box: Box; what: string }[]; titles: { box: Box; what: string }[] } {
  const linked = (p: Placed, port: string): boolean => topo.net.linkAt({ device: p.device.id, port }) !== undefined;
  const ends = topo.net.links.flatMap((l) => {
    const a = topo.get(l.a.device);
    const b = topo.get(l.b.device);
    if (!a || !b) return [];
    return [[a, b, l.a.port], [b, a, l.b.port]].map(([from, to, port]) => ({ box: endLabel(from as Placed, to as Placed, port as string, linked).box, what: `${(from as Placed).label} ${port}` }));
  });
  const devices = [...topo.placed.values()].flatMap((p) => deviceShapes(p, (port) => linked(p, port)).map((r) => ({ box: { x0: p.x + r.x0, y0: p.y + r.y0, x1: p.x + r.x1, y1: p.y + r.y1 }, what: `${p.label} (drawing)` })));
  const titles = topo.annotations.flatMap((a) => {
    if (!a.text) return [];
    const size = a.size ?? 16;
    const x = Math.min(...a.points.map((p) => p.x));
    const y = Math.min(...a.points.map((p) => p.y));
    const box = a.kind === 'text' ? { x0: x, y0: y - size, x1: x + a.text.length * AREA_CHAR, y1: y + 3 } : { x0: x + AREA_PAD, y0: y + AREA_PAD, x1: x + AREA_PAD + a.text.length * AREA_CHAR, y1: y + AREA_PAD + size + 3 };
    return [{ box, what: `«${a.text}»` }];
  });
  return { ends, devices, titles };
}

for (const ex of EXAMPLES) {
  test(`${ex.id}: cable-end labels clear of each other, of the devices and of the areas; devices clear of area names`, () => {
    const { ends, devices, titles } = boxes(ex.build());
    const clashes: string[] = [];
    ends.forEach((e, i) => {
      for (const f of ends.slice(i + 1)) if (hit(e.box, f.box)) clashes.push(`${e.what} × ${f.what}`);
      for (const o of [...devices, ...titles]) if (hit(e.box, o.box)) clashes.push(`${e.what} × ${o.what}`);
    });
    for (const d of devices) for (const ti of titles) if (hit(d.box, ti.box)) clashes.push(`${d.what} × ${ti.what}`);
    assert.deepEqual(clashes, []);
  });
}
