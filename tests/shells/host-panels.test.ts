/**
 * What the Servicios panels of a GNU/Linux PC (and the Samba panel of a Server) do without the terminal: the
 * firewall saved and started through nftables.service, and Samba's shares and accounts in smb.conf and passdb.tdb.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { applyAndSave, firewallStatus, reloadFirewall, setFirewallActive } from '../../src/shells/firewall-save.ts';
import { runNft } from '../../src/net/nft/apply.ts';
import { EMPTY_RULESET } from '../../src/net/nft/model.ts';
import {
  addSambaShare, removeSambaAccount, removeSambaShare, sambaView, setSambaAccountDisabled, setSambaPassword, setSambaRunning,
} from '../../src/shells/samba-admin.ts';
import { journalUnits } from '../../src/net/pkg-units.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'samba')!.build();
  return { srv: t.byLabel('SRV') as Host, pc1: t.byLabel('PC1') as Host };
}

const DROP_PING = 'table inet filter {\n chain input {\n  type filter hook input priority 0; policy accept;\n  icmp type echo-request drop\n }\n}';

test('the firewall panel of a PC: saving starts and enables nftables.service, switching it off flushes the rules', () => {
  const { pc1 } = lab();
  run(pc1, 'apt install -y nftables samba');
  assert.deepEqual(journalUnits(pc1), ['smbd', 'nmbd', 'nftables']);
  const before = firewallStatus(pc1);
  assert.deepEqual([before.active, before.enabled], [false, false]);
  const r = runNft(EMPTY_RULESET, DROP_PING);
  assert.ok(r.ok);
  applyAndSave(pc1, r.ruleset);
  assert.deepEqual(firewallStatus(pc1), { active: true, enabled: true, saved: true });
  assert.equal(run(pc1, 'systemctl is-active nftables; systemctl is-enabled nftables'), 'active\nenabled');
  assert.match(run(pc1, 'cat /etc/nftables.conf'), /icmp type echo-request drop/);
  assert.equal(reloadFirewall(pc1), null);
  setFirewallActive(pc1, false);
  assert.equal(run(pc1, 'systemctl is-active nftables; systemctl is-enabled nftables'), 'inactive\ndisabled');
  assert.equal(pc1.kernel.netfilter.ruleset.tables.length, 0);
  setFirewallActive(pc1, true);
  assert.match(run(pc1, 'nft list ruleset'), /icmp type echo-request drop/, 'starting loads the saved file');
});

test('the Samba panel: smbd and nmbd, the shares of smb.conf and the Samba accounts', () => {
  const { srv } = lab();
  const view = sambaView(srv);
  assert.ok(view.running);
  assert.deepEqual(view.shares.map((s) => s.name), ['print$', 'publico', 'profes']);
  assert.deepEqual(view.accounts.map((a) => a.name), ['ana']);
  assert.ok(view.users.includes('luis') && !view.users.includes('root') && !view.users.includes('nobody'));
  assert.deepEqual(journalUnits(srv), ['smbd', 'nmbd'], 'the Registros of the packages (a Server keeps its own firewall unit)');

  assert.equal(addSambaShare(srv, { name: 'publico', path: '/srv/x', comment: '', readOnly: false, guestOk: true }), 'smb.err.exists');
  assert.equal(addSambaShare(srv, { name: 'mal/nombre', path: '/srv/x', comment: '', readOnly: false, guestOk: true }), 'smb.err.name');
  assert.equal(addSambaShare(srv, { name: 'docs', path: 'relativa', comment: '', readOnly: false, guestOk: true }), 'smb.err.path');
  assert.equal(addSambaShare(srv, { name: 'docs', path: '/srv/samba/docs', comment: 'Apuntes\n[global]', readOnly: true, guestOk: true }), null);
  assert.match(run(srv, 'testparm -s 2>/dev/null'), /\[docs\]\n\tbrowseable = Yes\n\tcomment = Apuntes \[global\]\n\tguest ok = Yes\n\tpath = \/srv\/samba\/docs\n\tread only = Yes$/);
  assert.match(run(srv, 'ls -ld /srv/samba/docs'), /^drwxr-xr-x /, 'the folder is created');
  removeSambaShare(srv, 'docs');
  assert.ok(!sambaView(srv).shares.some((s) => s.name === 'docs'));

  assert.equal(setSambaPassword(srv, 'pepe', 'x'), 'smb.err.user');
  assert.equal(setSambaPassword(srv, 'luis', ''), 'smb.err.password');
  assert.equal(setSambaPassword(srv, 'luis', 'luis1'), null);
  setSambaAccountDisabled(srv, 'luis', true);
  assert.match(run(srv, 'pdbedit -L | sort'), /^ana:\d+:\nluis:\d+:$/);
  assert.ok(sambaView(srv).accounts.find((a) => a.name === 'luis')?.disabled);
  removeSambaAccount(srv, 'luis');
  assert.deepEqual(sambaView(srv).accounts.map((a) => a.name), ['ana']);

  setSambaRunning(srv, false);
  assert.equal(run(srv, 'systemctl is-active smbd; systemctl is-active nmbd; systemctl is-enabled smbd'), 'inactive\ninactive\ndisabled');
  assert.ok(!sambaView(srv).running);
  setSambaRunning(srv, true);
  assert.equal(run(srv, 'systemctl is-active smbd; systemctl is-active nmbd'), 'active\nactive');
});
