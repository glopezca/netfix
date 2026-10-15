/** Areas of the labs: present, inside the workspace, around their devices and not overlapping each other. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { LABS_WITH_AREAS } from '../../src/net/lab-areas.ts';
import { boundsOf } from '../../src/net/annotations.ts';
import { setLocale } from '../../src/i18n/locale.ts';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('labs with didactic areas draw them, named and apart', () => {
  for (const id of LABS_WITH_AREAS) {
    const ex = EXAMPLES.find((e) => e.id === id);
    assert.ok(ex, id);
    const topo = ex.build();
    const rects = topo.annotations.filter((a) => a.kind === 'rect');
    assert.ok(rects.length > 0, `${id}: no areas`);
    for (const r of rects) {
      assert.ok(r.text && r.text.length > 3, `${id}: unnamed area`);
      const b = boundsOf(r);
      assert.ok(b.x >= 0 && b.y >= 0 && b.w > 100 && b.h > 100, `${id}: ${r.text} ${JSON.stringify(b)}`);
    }
    for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) assert.ok(!overlap(boundsOf(a), boundsOf(b)), `${id}: «${a.text}» overlaps «${b.text}»`);
  }
});

test('the DMZ lab separates LAN, DMZ and Internet, and the VPN labs draw their tunnel', () => {
  const texts = (id: string): string[] => EXAMPLES.find((e) => e.id === id)?.build().annotations.map((a) => a.text ?? '') ?? [];
  assert.deepEqual(texts('linux-dmz').filter(Boolean).map((s) => s.split(' · ')[0]), ['Internet', 'LAN', 'DMZ', 'Cliente externo (otra red)']);
  assert.ok(texts('vpn-ipsec').some((s) => s.startsWith('Túnel IPsec')));
  assert.ok(texts('vpn-wireguard').some((s) => s.includes('10.99.0.0/24')));
  setLocale('en-GB');
  try {
    assert.ok(texts('vpn-wireguard').some((s) => s.startsWith('WireGuard tunnel')), 'areas follow the interface language');
  } finally {
    setLocale('es-ES');
  }
});
