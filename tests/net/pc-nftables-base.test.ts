/**
 * nftables is part of Ubuntu's base system (priority important): a new PC has it, as a Server has its firewall, so a
 * GNU/Linux PC shows the Firewall panel from the start. The service is installed stopped and disabled (Debian's
 * default); apt can remove it, a lab that takes it away leaves new PCs without it, and a file says what a PC has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { deviceApps, setDeviceApps } from '../../src/net/device-apps.ts';
import { hasPackage, isPackageAuto } from '../../src/net/host-packages.ts';
import { hostPanels } from '../../src/net/pkg-units.ts';
import { listedPackages } from '../../src/shells/apt-offer.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));

function linuxPc(t: Topology): { pc: Host; label: string } {
  const placed = t.add('pc', 0, 0);
  const pc = placed.device as Host;
  setDeviceApps(pc, [...deviceApps(pc), 'linux']);
  return { pc, label: placed.label };
}

const reload = (t: Topology): Topology => Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));

test('a new PC has nftables installed, its libraries automatic, and the Firewall panel with GNU/Linux', () => {
  const { pc } = linuxPc(new Topology());
  assert.ok(hasPackage(pc, 'nftables'));
  assert.ok(!isPackageAuto(pc, 'nftables'), 'part of the system, not a dependency');
  assert.ok(isPackageAuto(pc, 'libnftables1'));
  assert.deepEqual(hostPanels(pc), ['sysctl', 'firewall', 'files', 'log']);
  assert.deepEqual(listedPackages(pc).find((p) => p.name === 'nftables'), { name: 'nftables', installed: true, service: true });
});

test('the preinstalled nftables is stopped and disabled, and apt can remove it', () => {
  const { pc } = linuxPc(new Topology());
  assert.equal(run(pc, 'systemctl is-active nftables'), 'inactive');
  assert.equal(run(pc, 'systemctl is-enabled nftables'), 'disabled');
  run(pc, 'apt remove -y nftables');
  assert.ok(!hasPackage(pc, 'nftables'));
  assert.deepEqual(hostPanels(pc), ['sysctl', 'files']);
});

test('systemctl list-units leaves the stopped nftables out, as systemd; --all and list-unit-files show it', () => {
  const { pc } = linuxPc(new Topology());
  assert.doesNotMatch(run(pc, 'systemctl list-units'), /nftables/);
  assert.match(run(pc, 'systemctl list-units --all'), /nftables\.service +loaded inactive dead/);
  assert.match(run(pc, 'systemctl list-unit-files'), /nftables\.service/);
});

test('a lab that takes nftables away leaves new PCs without it', () => {
  const t = new Topology();
  t.pkgsOff = ['nftables'];
  assert.ok(!hasPackage(linuxPc(t).pc, 'nftables'));
});

test('a saved PC keeps what it had: removed stays removed, installed stays installed', () => {
  const t = new Topology();
  const kept = linuxPc(t);
  const gone = linuxPc(t);
  run(gone.pc, 'apt remove -y nftables');
  const again = reload(t);
  assert.ok(hasPackage(again.byLabel(kept.label) as Host, 'nftables'));
  assert.ok(!hasPackage(again.byLabel(gone.label) as Host, 'nftables'), 'the file says what the PC has');
});

test('a file from before the change (no packages) is read as it was: no nftables', () => {
  const t = new Topology();
  const { label } = linuxPc(t);
  const file = JSON.parse(JSON.stringify(t.toJSON())) as { devices: { pc?: Record<string, unknown> }[] };
  for (const d of file.devices) if (d.pc) { delete d.pc.packages; delete d.pc.autoPackages; }
  assert.ok(!hasPackage(Topology.fromJSON(file).byLabel(label) as Host, 'nftables'));
});

test('a Server is not changed: its firewall is its own unit', () => {
  const srv = new Topology().add('server', 0, 0).device as Host;
  assert.ok(!hasPackage(srv, 'nftables'), 'a Server tracks nftables through its Firewall service, not the PC registry');
});
