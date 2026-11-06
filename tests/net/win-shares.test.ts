/**
 * «Compartir archivos e impresoras para redes Microsoft» on Windows: the lab feature (PC and Server), the device's box
 * (unticked in each device), the shares it publishes (name, folder, comment and the permission of Everyone), their
 * checks, and the file round trip of untrusted records.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Host } from '../../src/devices/host.ts';
import { fileFeatures, featureOn, setFeature, FEATURES_V } from '../../src/net/lab-features.ts';
import { addWinShare, removeWinShare, findWinShare, winShares, winShareOn, setWinShareOn, winShareOffered, winShareActive, MAX_SHARES } from '../../src/net/win-shares.ts';

const lab = (): Topology => EXAMPLES.find((e) => e.id === 'basico')!.build();
const windowsPc = (topo: Topology): Host => {
  const h = topo.byLabel('PC1') as Host;
  h.os = 'windows';
  return h;
};
const docs = { name: 'docs', path: 'C:\\Users\\Public\\Documents', remark: 'Apuntes', access: 'read' as const };

test('a lab feature of PCs and Servers, on by default; files from before it keep it on', () => {
  assert.equal(featureOn({}, 'pc', 'winshare'), true);
  assert.equal(featureOn({}, 'server', 'winshare'), true);
  assert.equal(featureOn({}, 'linuxrouter', 'winshare'), false);
  const v2 = fileFeatures({ pc: ['ip', 'apps', 'samba', 'linux'] }, 2, undefined);
  assert.equal(featureOn(v2, 'pc', 'winshare'), true, 'a v0.35 list never names it');
  assert.equal(featureOn(v2, 'pc', 'windows'), false);
  const off = setFeature({}, 'pc', 'winshare', false);
  assert.equal(featureOn(fileFeatures(off, FEATURES_V, undefined), 'pc', 'winshare'), false, 'saved off, read back off');
});

test('the box: unticked in each device, only on Windows and while the lab allows it', () => {
  const topo = lab();
  const h = windowsPc(topo);
  assert.equal(winShareOffered(h), true);
  assert.equal(winShareOn(h), false);
  assert.equal(winShareActive(h), false);
  setWinShareOn(h, true);
  assert.equal(winShareActive(h), true);
  topo.features = setFeature(topo.features, 'pc', 'winshare', false);
  assert.equal(winShareOffered(h), false);
  assert.equal(winShareActive(h), false, 'the lab took it away');
  topo.features = {};
  h.os = 'linux';
  assert.equal(winShareOffered(h), false, 'not a Windows device');
});

test('a share: checked name, folder of drive C:, comment and permission', () => {
  const h = windowsPc(lab());
  assert.equal(addWinShare(h, docs), undefined);
  assert.deepEqual(findWinShare(h, 'DOCS'), docs, 'names are matched without regard to case');
  assert.equal(addWinShare(h, { ...docs, name: 'Docs' }), 'exists');
  for (const name of ['', 'a/b', 'a\\b', 'x:y', 'a*', 'q?', 'c"d', '<x>', 'a|b', 'a=b', 'a;b', 'a,b', '[x]', 'a+b', 'a\u0007b', 'x'.repeat(81)]) {
    assert.equal(addWinShare(h, { ...docs, name }), 'name', JSON.stringify(name));
  }
  for (const name of ['IPC$', 'admin$', 'C$']) assert.equal(addWinShare(h, { ...docs, name }), 'reserved', name);
  for (const path of ['Users', 'D:\\datos', 'C:\\a\\..\\etc', 'C:\\a\\.\\b', 'C:\\a<b', `C:\\${'a'.repeat(260)}`, 'C:\\a\u0000b']) {
    assert.equal(addWinShare(h, { ...docs, name: 'otro', path }), 'path', JSON.stringify(path));
  }
  assert.equal(addWinShare(h, { ...docs, name: 'otro', remark: 'x'.repeat(257) }), 'remark');
  assert.equal(addWinShare(h, { ...docs, name: 'oculto$', path: 'c:\\srv\\' }), undefined, 'a hidden share; the drive and the last \\ are tidied');
  assert.equal(findWinShare(h, 'oculto$')?.path, 'C:\\srv');
  assert.equal(addWinShare(h, { ...docs, name: 'raiz', path: 'C:\\' }), undefined);
  assert.equal(findWinShare(h, 'raiz')?.path, 'C:\\');
  assert.equal(removeWinShare(h, 'RAIZ'), true);
  assert.equal(removeWinShare(h, 'raiz'), false);
  assert.deepEqual(winShares(h).map((s) => s.name), ['docs', 'oculto$']);
});

test('no look-alikes: invisible and bidi characters, or spaces around a name; a folder is kept as Windows reads it', () => {
  const h = windowsPc(lab());
  for (const name of [' docs', 'docs ', 'ADMIN\u200b$', 'a\u202eb', 'a\u0085b', 'a\u2066b', '\ufeffx']) {
    assert.equal(addWinShare(h, { ...docs, name }), 'name', JSON.stringify(name));
  }
  assert.equal(addWinShare(h, { ...docs, remark: 'abc\u202edcp.exe' }), 'remark');
  for (const path of ['C:\\a\\. .', 'C:\\a\\...', 'C:\\ \\b']) {
    assert.equal(addWinShare(h, { ...docs, name: 'otro', path }), 'path', JSON.stringify(path));
  }
  assert.equal(addWinShare(h, { ...docs, path: 'C:\\Users\\Public. \\Documents. ' }), undefined);
  assert.equal(findWinShare(h, 'docs')?.path, 'C:\\Users\\Public\\Documents', 'trailing dots and spaces dropped, as Win32 does');
});

test('at most MAX_SHARES shares', () => {
  const h = windowsPc(lab());
  for (let i = 0; i < MAX_SHARES; i++) assert.equal(addWinShare(h, { ...docs, name: `r${i}` }), undefined);
  assert.equal(addWinShare(h, { ...docs, name: 'uno-mas' }), 'full');
});

test('saved with the device; a crafted record keeps only what passes the checks', () => {
  const topo = lab();
  const h = windowsPc(topo);
  setWinShareOn(h, true);
  addWinShare(h, docs);
  addWinShare(h, { name: 'pub', path: 'C:\\srv', remark: '', access: 'full' });
  const file = JSON.parse(JSON.stringify(topo.toJSON())) as { devices: { label: string; pc?: Record<string, unknown> }[] };
  const back = Topology.fromJSON(file).byLabel('PC1') as Host;
  assert.equal(winShareOn(back), true);
  assert.deepEqual(winShares(back), winShares(h));
  const rec = file.devices.find((d) => d.label === 'PC1')!.pc!;
  rec.winShare = { on: 'yes', shares: [docs, { ...docs, name: 'DOCS' }, { ...docs, name: 'mal/nombre' }, { ...docs, name: 'x', access: 'admin' }, 7, { name: 'y', path: 'C:\\y' }, ...Array.from({ length: 40 }, (_, i) => ({ ...docs, name: `n${i}` }))] };
  const crafted = Topology.fromJSON(file).byLabel('PC1') as Host;
  assert.equal(winShareOn(crafted), false, 'only true turns it on');
  const names = winShares(crafted).map((s) => s.name);
  assert.equal(names[0], 'docs');
  assert.ok(!names.includes('DOCS') && !names.includes('mal/nombre') && !names.includes('x') && !names.includes('y'));
  assert.equal(names.length, MAX_SHARES);
  const plain = lab();
  assert.equal('winShare' in (plain.toJSON().devices.find((d) => d.label === 'PC1')?.pc ?? {}), false, 'nothing saved while unused');
});
