/** The Labs menu groups the labs by theme: every lab in exactly one group, and the name-resolution labs work. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { LAB_GROUPS } from '../../src/labs/lab-groups.ts';
import { hasMessage } from '../../src/i18n/t.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');
const sh = (h: Host, cmd: string): string => createShell(h, 'linux', 'root').run(cmd).join('\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

test('every lab is in exactly one group, and every group has a title', () => {
  const grouped = LAB_GROUPS.flatMap(([, ids]) => ids);
  assert.deepEqual([...grouped].sort(), EXAMPLES.map((e) => e.id).sort());
  assert.equal(new Set(grouped).size, grouped.length);
  for (const [id] of LAB_GROUPS) assert.ok(hasMessage(`labgroup.${id}`), id);
});

test('names in a LAN with no DNS of its own: LLMNR and mDNS on Windows, avahi on LNX1, nothing on LNX2', () => {
  const t = lab('nombres-lan');
  const [win1, lnx1, lnx2] = ['WIN1', 'LNX1', 'LNX2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  assert.match(win(win1, 'ping -n 1 win2'), /Pinging win2 \[192\.168\.1\.12\][\s\S]*Reply from 192\.168\.1\.12/);
  assert.match(win(win1, 'ping -n 1 win2.local'), /Reply from 192\.168\.1\.12/);
  assert.match(win(win1, 'ping -n 1 lnx1.local'), /Reply from 192\.168\.1\.21/, 'avahi answers');
  assert.match(win(win1, 'ping -n 1 lnx2'), /could not find host lnx2/);
  assert.match(sh(lnx1, 'ping -c 1 win1.local'), /1 received/);
  assert.match(sh(lnx2, 'ping -c 1 win1.local; echo "status $?"'), /status 2$/);
  sh(lnx2, 'echo "192.168.1.11 win1" >> /etc/hosts');
  assert.match(sh(lnx2, 'ping -c 1 win1'), /1 received/);
  assert.match(sh(lnx2, 'apt install -y samba'), /Setting up samba/, 'apt reaches the mirrors through GW');
  assert.match(win(win1, 'ping -n 1 lnx2'), /Reply from 192\.168\.1\.22/, 'NetBIOS from samba');
});

test('names across networks: the DNS crosses the router, LLMNR does not', () => {
  const t = lab('nombres-redes');
  const [winA, winB] = ['WIN-A', 'WIN-B'].map((l) => t.byLabel(l) as Host) as [Host, Host];
  assert.match(win(winA, 'ping -n 2 win-b'), /Pinging win-b\.aula\.lab \[192\.168\.20\.11\][\s\S]*Reply from/);
  assert.match(win(winA, 'ping -n 1 win-b2'), /could not find host win-b2/);
  assert.match(win(winB, 'ping -n 1 win-b2'), /Pinging win-b2 \[192\.168\.20\.12\][\s\S]*Reply from/);
});
