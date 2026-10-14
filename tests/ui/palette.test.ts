/** Palette: device order and names (PC, Server, IOS switch, IOS router, Linux router, cloud). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACEABLE } from '../../src/ui/palette.ts';
import { ICONS, MODEL_LABEL } from '../../src/ui/icons.ts';
import { t } from '../../src/i18n/t.ts';
import { setLocale } from '../../src/i18n/locale.ts';

test('the palette lists PC, Server, switch, the two routers together and the cloud', () => {
  assert.deepEqual(PLACEABLE.map(([k]) => k), ['pc', 'server', 'switch', 'router', 'linuxrouter', 'cloud']);
  assert.deepEqual(PLACEABLE.map(([, key]) => t(key)), ['PC', 'Servidor', 'Switch IOS', 'Router IOS', 'Router Linux', 'Nube']);
  assert.equal(MODEL_LABEL.router, '2911');
  assert.equal(MODEL_LABEL.linuxrouter, 'Ubuntu');
  // One router symbol on the canvas and in the palette (the old terminal-prompt icon is gone).
  assert.equal(ICONS.linuxrouter, ICONS.router);
  assert.equal(t('model.cloud'), 'ISP → Internet');
  setLocale('en-GB');
  try {
    assert.deepEqual(PLACEABLE.map(([, key]) => t(key)), ['PC', 'Server', 'IOS switch', 'IOS router', 'Linux router', 'Cloud']);
  } finally {
    setLocale('es-ES');
  }
});
