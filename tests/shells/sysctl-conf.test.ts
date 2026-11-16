/**
 * /etc/sysctl.conf as the place the GUI saves kernel parameters: it shows the saved state (ip_forward uncommented in
 * place) and applies it (sysctl -p, --system, opening the lab); sysctl -w and /proc stay runtime-only, as on Ubuntu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { saveSysctl } from '../../src/shells/kernel-save.ts';

const CONF = '/etc/sysctl.conf';
const LEGACY = '/etc/sysctl.d/99-netfix.conf';

function lab(): { t: Topology; r: LinuxRouter; root: ReturnType<typeof createShell> } {
  const t = new Topology();
  const r = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  return { t, r, root: createShell(r, 'linux', 'root') };
}
const conf = (r: LinuxRouter): string => String(hostSystem(r).fs.readFile(CONF));
const forwardLines = (r: LinuxRouter): string[] => conf(r).split('\n').filter((l) => /ip_forward/.test(l));

test('the GUI saves ip_forward in /etc/sysctl.conf, uncommenting the stock line in place', () => {
  const { r } = lab();
  const before = conf(r).split('\n');
  const at = before.indexOf('#net.ipv4.ip_forward=1');
  assert.ok(at > 0, 'Ubuntu ships the line commented');
  assert.equal(saveSysctl(r, 'net.ipv4.ip_forward', '1'), null);
  assert.equal(r.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
  const after = conf(r).split('\n');
  assert.equal(after[at], 'net.ipv4.ip_forward=1', 'same line, same format');
  assert.equal(after.length, before.length, 'nothing appended');
  assert.ok(!hostSystem(r).fs.tryLookup(LEGACY), '99-netfix.conf is no longer written');
  saveSysctl(r, 'net.ipv4.ip_forward', '0');
  assert.deepEqual(forwardLines(r), ['net.ipv4.ip_forward=0'], 'off is written too: the file says what is saved');
});

test('an active line keeps its spacing; later duplicates go; a key not in the file is appended', () => {
  const { r } = lab();
  const fs = hostSystem(r).fs;
  fs.writeFile(CONF, 'net.ipv4.ip_forward = 0\nkernel.sysrq=438\nnet.ipv4.ip_forward=0\n');
  saveSysctl(r, 'net.ipv4.ip_forward', '1');
  assert.equal(conf(r), 'net.ipv4.ip_forward = 1\nkernel.sysrq=438\n', 'a later line would win on sysctl -p');
  saveSysctl(r, 'net.ipv4.conf.all.rp_filter', '2');
  assert.equal(conf(r), 'net.ipv4.ip_forward = 1\nkernel.sysrq=438\nnet.ipv4.conf.all.rp_filter = 2\n');
});

test('a lab saved with 99-netfix.conf: the saved key moves to sysctl.conf and the old file goes when empty', () => {
  const { r } = lab();
  const fs = hostSystem(r).fs;
  fs.writeFile(LEGACY, '# Netfix: parámetros guardados desde la ventana del equipo o la gestión web.\nnet.ipv4.ip_forward = 1\n');
  saveSysctl(r, 'net.ipv4.ip_forward', '0');
  assert.ok(!fs.tryLookup(LEGACY), 'only the header was left');
  assert.deepEqual(forwardLines(r), ['net.ipv4.ip_forward=0']);
  fs.writeFile(LEGACY, '# Netfix\nnet.ipv4.ip_forward = 1\nkernel.sysrq = 1\n');
  saveSysctl(r, 'net.ipv4.ip_forward', '1');
  assert.equal(String(fs.readFile(LEGACY)), '# Netfix\nkernel.sysrq = 1\n', 'other keys stay where they were');
});

test('sysctl -w and echo > /proc change the running value only; sysctl -p applies the edited file', () => {
  const { r, root } = lab();
  const stock = conf(r);
  root.run('sysctl -w net.ipv4.ip_forward=1');
  root.run('echo 0 > /proc/sys/net/ipv4/ip_forward');
  root.run('echo 1 > /proc/sys/net/ipv4/ip_forward');
  assert.equal(r.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
  assert.equal(conf(r), stock, 'runtime changes do not touch the file');
  root.run('sysctl -w net.ipv4.ip_forward=0');
  root.run("sed -i 's/^#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf");
  assert.deepEqual(root.run('sysctl -p'), ['net.ipv4.ip_forward = 1']);
  assert.equal(r.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
});

test('the saved value is what the lab boots with after save and open', () => {
  const { t, r } = lab();
  saveSysctl(r, 'net.ipv4.ip_forward', '1');
  createShell(r, 'linux', 'root').run('sysctl -w net.ipv4.ip_forward=0'); // runtime only: lost on the next boot
  const copy = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = [...copy.placed.values()][0]?.device as LinuxRouter;
  assert.equal(again.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
  assert.deepEqual(forwardLines(again), ['net.ipv4.ip_forward=1']);
});
