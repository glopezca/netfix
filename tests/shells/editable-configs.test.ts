/**
 * Guard (.claude/rules/project/service-config-files.md): every file of the «Ficheros» view (config-files.ts) is either
 * in the registry of editable service files, with a checker and an importer, or below with the reason it is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_SOURCES } from '../../src/services/config-files.ts';
import { EDITABLE_CONFIGS, editableOf } from '../../src/shells/editable-configs.ts';
import { UNITS } from '../../src/services/units.ts';

/** Files outside the registry: none is generated from the model, so there is nothing to import back. */
const UNREGISTERED: Readonly<Record<string, string>> = {
  '/etc/sysctl.conf': 'an ordinary root file: sysctl --system applies it (kernel-files.ts)',
  '/etc/sysctl.d': 'ordinary root files: sysctl --system applies them',
  '/etc/nftables.conf': 'an ordinary root file: nftables.service loads it with nft -f at start and reload',
  '/etc/wireguard': 'ordinary root files: wg-quick reads them',
  '/etc/ssh/sshd_config': 'an ordinary root file: ssh.service checks it with sshd -t at start and reload',
  '/etc/ssh/sshd_config.d': 'ordinary root files: read with sshd_config',
  '/etc/apache2/apache2.conf': "Apache's own tree: apachectl configtest at start and reload",
  '/etc/apache2/ports.conf': "Apache's own tree",
  '/etc/apache2/sites-enabled': "Apache's own tree",
  '/etc/apache2/conf-enabled': 'the Roundcube and web management snippets are read-only views of Servicios → HTTP; the rest is Apache’s own tree',
  '/etc/samba/smb.conf': 'an ordinary root file: smbd, nmbd and winbind read it (testparm checks it)',
  '/etc/avahi/avahi-daemon.conf': 'an ordinary root file read by avahi-daemon',
  '/etc/nsswitch.conf': 'an ordinary root file read by the resolver',
};

const registered = (p: string): boolean => editableOf(p) !== undefined || editableOf(`${p}/named.conf`) !== undefined;

test('every file of the «Ficheros» view is registered as editable or listed with its reason', () => {
  const paths = [...new Set(CONFIG_SOURCES.flatMap((s) => s.paths))];
  const loose = paths.filter((p) => !registered(p) && !(p in UNREGISTERED));
  assert.deepEqual(loose, [], 'register them in src/shells/editable-configs.ts or justify them in UNREGISTERED');
  const stale = Object.keys(UNREGISTERED).filter((p) => registered(p) || !paths.includes(p));
  assert.deepEqual(stale, [], 'UNREGISTERED lists only files the view has and the registry does not');
});

test('the registry: one entry per unit, each a known unit whose directories hold its files', () => {
  const units = EDITABLE_CONFIGS.map((c) => c.unit);
  assert.equal(new Set(units).size, units.length);
  for (const c of EDITABLE_CONFIGS) assert.ok(UNITS.some((u) => u.id === c.unit), c.unit);
  for (const p of ['/etc/kea/kea-dhcp4.conf', '/etc/bind/db.aula.lab', '/etc/postfix/main.cf', '/etc/dovecot/dovecot.conf']) {
    const c = editableOf(p);
    assert.ok(c?.dirs.includes(p.slice(0, p.lastIndexOf('/'))), p);
  }
  assert.equal(editableOf('/etc/bind/sub/x'), undefined, 'only the files right in /etc/bind');
  assert.equal(editableOf('/etc/postfix/master.cf'), undefined);
});
