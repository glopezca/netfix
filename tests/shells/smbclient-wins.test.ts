/**
 * smbclient follows Samba's «name resolve order» (lmhosts wins host bcast): with «wins server» in smb.conf it asks
 * that WINS server by unicast, which crosses routers, before the system resolver and the broadcast. Lab
 * «nombres-resolved»: LNX-A (LAN A) serves Samba and registers with SRV-WINS; LNX-B (LAN B) looks for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { parseSmbConf } from '../../src/services/smb-conf.ts';

const WINS_LINE = "sed -i 's/^   workgroup = WORKGROUP$/&\\n   wins server = 192.168.10.2/' /etc/samba/smb.conf";

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'nombres-resolved')!.build();
  const sh = (l: string, c: string): string => createShell(t.byLabel(l) as Host, 'linux', 'root').run(c).join('\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  sh('LNX-A', `apt install -y samba; ${WINS_LINE}; systemctl restart nmbd`);
  t.net.runFor(2000);
  sh('LNX-B', 'apt install -y smbclient');
  return { t, sh };
}

test('without «wins server», smbclient cannot find a server past the router', () => {
  const { sh } = lab();
  assert.match(sh('LNX-B', 'smbclient -L //lnx-a -N; echo "status $?"'), /Connection to lnx-a failed \(Error NT_STATUS_UNSUCCESSFUL\)\nstatus 1/);
});

test('with «wins server», smbclient asks the WINS and lists the shares of LNX-A', () => {
  const { sh } = lab();
  sh('LNX-B', WINS_LINE);
  const out = sh('LNX-B', 'smbclient -L //lnx-a -N; echo "status $?"');
  assert.match(out, /Sharename +Type +Comment/);
  assert.match(out, /IPC\$ +IPC/);
  assert.match(out, /status 0$/);
});

test('«name resolve order» without wins skips the WINS server', () => {
  const { sh } = lab();
  sh('LNX-B', WINS_LINE.replace('wins server = 192.168.10.2', 'wins server = 192.168.10.2\\n   name resolve order = host bcast'));
  assert.match(sh('LNX-B', 'smbclient -L //lnx-a -N; echo "status $?"'), /NT_STATUS_UNSUCCESSFUL\)\nstatus 1/);
});

test('«name resolve order» keeps the known methods, in order and once; empty or unknown is the default', () => {
  const order = (v: string): readonly string[] => parseSmbConf(`[global]\n   name resolve order = ${v}\n`).nameResolveOrder;
  assert.deepEqual(order('bcast wins, host wins'), ['bcast', 'wins', 'host']);
  assert.deepEqual(order('nada'), ['lmhosts', 'wins', 'host', 'bcast']);
  assert.deepEqual(parseSmbConf('').nameResolveOrder, ['lmhosts', 'wins', 'host', 'bcast']);
  assert.deepEqual(parseSmbConf('[global]\n   name resolve order = host\n').unknown, []);
});
