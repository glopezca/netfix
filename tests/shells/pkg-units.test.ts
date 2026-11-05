/**
 * The services apt's packages bring on any GNU/Linux host, a PC too: samba's smbd and nmbd start on install, nftables
 * is installed stopped (Debian's default); systemctl and journalctl see them while the package is there, and the PC's
 * Servicios tab follows: kernel parameters always, the package's panel, its configuration files and its logs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { onAppsChange } from '../../src/net/device-apps.ts';
import { hostPanels } from '../../src/net/pkg-units.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));

test('samba on a PC: smbd and nmbd run and are enabled, and go away with the package', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  assert.match(run(pc, 'systemctl status smbd; echo "status $?"'), /Unit smbd\.service could not be found\.\nstatus 4$/);
  run(pc, 'apt install -y samba');
  const st = run(pc, 'systemctl status smbd');
  assert.match(st, /^● smbd\.service - Samba SMB Daemon\n {5}Loaded: loaded \(\/usr\/lib\/systemd\/system\/smbd\.service; enabled; preset: enabled\)\n {5}Active: active \(running\)/);
  assert.match(st, /Main PID: \d+ \(smbd\)/);
  assert.equal(run(pc, 'systemctl is-enabled nmbd'), 'enabled');
  assert.equal(run(pc, 'systemctl is-active nmbd.service'), 'active');
  assert.match(run(pc, 'systemctl list-units'), /smbd\.service +loaded active +running Samba SMB Daemon[\s\S]*3 loaded units listed\./, 'with systemd-resolved, always there');
  assert.match(run(pc, 'journalctl -u smbd'), /smbd\[\d+\]: .*smbd version 4\.22\.3-Ubuntu started\./);
  run(pc, 'apt remove -y samba');
  assert.match(run(pc, 'systemctl status smbd; echo "status $?"'), /Unit smbd\.service could not be found\.\nstatus 4$/);
  assert.doesNotMatch(run(pc, 'systemctl list-units'), /smbd|nmbd/);
  assert.match(run(pc, 'systemctl list-units'), /\n1 loaded units listed\.$/);
});

test('stopping nmbd silences NetBIOS; stopping smbd closes 139/445', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  const win = (cmd: string): string => createShell(pc0, 'windows').run(cmd).join('\n');
  run(pc1, 'apt install -y samba');
  assert.match(run(pc1, 'systemctl stop smbd 2>&1', 'ana'), /Interactive authentication required/);
  run(pc1, 'systemctl stop nmbd');
  assert.match(win('ping -n 1 pc1'), /could not find host pc1/);
  run(pc1, 'systemctl start nmbd');
  assert.match(win('ping -n 1 pc1'), /Reply from /);
  const ip1 = run(pc1, 'hostname -I').trim().split(' ')[0];
  run(pc1, 'systemctl stop smbd');
  assert.match(win(`net view \\\\${ip1}`), /System error 53/);
  assert.match(run(pc1, 'systemctl status smbd; echo "status $?"'), /Active: inactive \(dead\)[\s\S]*status 3$/);
});

test('nftables on a PC: installed stopped; start loads /etc/nftables.conf, stop flushes, enable keeps it at boot', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y nftables');
  assert.equal(run(pc, 'systemctl is-active nftables'), 'inactive');
  assert.equal(run(pc, 'systemctl is-enabled nftables'), 'disabled');
  run(pc, `printf 'table inet filter {\\n chain input {\\n  type filter hook input priority 0; policy accept;\\n }\\n}\\n' > /etc/nftables.conf`);
  assert.equal(run(pc, 'systemctl start nftables; echo "status $?"'), 'status 0');
  assert.match(run(pc, 'nft list ruleset'), /table inet filter/);
  assert.match(run(pc, 'systemctl status nftables'), /Active: active \(exited\)/);
  run(pc, 'systemctl stop nftables');
  assert.equal(run(pc, 'nft list ruleset'), '');
  run(pc, 'echo "table oops {" > /etc/nftables.conf');
  assert.match(run(pc, 'systemctl start nftables 2>&1; echo "status $?"'), /Job for nftables\.service failed[\s\S]*status 1$/);
  assert.match(run(pc, 'journalctl -u nftables'), /\/etc\/nftables\.conf/);
});

test('the Servicios tab of a GNU/Linux PC: kernel parameters and files, then what apt brings (panel, logs)', () => {
  const t = lab('internet');
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  assert.deepEqual(hostPanels(pc0), [], 'a Windows PC has no Linux services');
  assert.deepEqual(hostPanels(pc1), ['sysctl', 'files']);
  const changed: unknown[] = [];
  onAppsChange((d) => changed.push(d));
  run(pc1, 'apt install -y nftables');
  assert.deepEqual(hostPanels(pc1), ['sysctl', 'firewall', 'files', 'log']);
  assert.ok(changed.includes(pc1), 'the open window is redrawn');
  run(pc1, 'apt install -y samba');
  assert.deepEqual(hostPanels(pc1), ['sysctl', 'firewall', 'samba', 'files', 'log']);
  run(pc1, 'apt remove -y nftables samba');
  assert.deepEqual(hostPanels(pc1), ['sysctl', 'files']);
});

test('samba on a Server: the Samba panel joins its Servicios, and smb.conf is shipped', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Host;
  assert.ok(!hostPanels(srv).includes('samba'));
  run(srv, 'apt install -y samba');
  assert.ok(hostPanels(srv).includes('samba'));
  assert.match(run(srv, 'cat /etc/samba/smb.conf'), /^\[global\]$[\s\S]*workgroup = WORKGROUP/m);
  assert.equal(run(srv, 'systemctl is-active smbd'), 'active');
  assert.match(run(srv, 'systemctl list-units'), /smbd\.service/);
});

test('unit states are saved with the topology', () => {
  const t = lab('internet');
  const pc = t.byLabel('PC1') as Host;
  run(pc, 'apt install -y samba nftables');
  run(pc, 'echo "table inet f {}" > /etc/nftables.conf; systemctl enable --now nftables; systemctl stop smbd');
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON()))).byLabel('PC1') as Host;
  assert.equal(run(again, 'systemctl is-active smbd'), 'inactive');
  assert.equal(run(again, 'systemctl is-active nmbd'), 'active');
  assert.equal(run(again, 'systemctl is-enabled nftables'), 'enabled');
  assert.match(run(again, 'nft list ruleset'), /table inet f/, 'an enabled nftables loads its file at boot');
});
