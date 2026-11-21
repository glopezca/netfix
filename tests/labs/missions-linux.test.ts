/**
 * The GNU/Linux DHCP missions (S26 phase 4) solved the way a student does it, with the commands of the hints
 * (files, systemctl, netplan, IOS on the ISP), not with the lab's own build: each one scores full marks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missionStart, missionRubric } from '../../src/labs/mission-build.ts';
import { missionById } from '../../src/labs/missions.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { createShell } from '../../src/shells/factory.ts';
import { Session } from '../../src/ios/session.ts';
import { cpeNetplan } from '../../src/net/labs-dhcp-linux.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Router } from '../../src/devices/router.ts';

function root(t: Topology, label: string, script: string): string[] {
  const s = createShell(t.byLabel(label) as Server, 'linux', 'root');
  s.run('set +H; export SYSTEMD_COLORS=0');
  return s.run(script);
}

function renew(t: Topology, labels: readonly string[]): void {
  for (const l of labels) (t.byLabel(l) as Host).releaseDhcp();
  t.settle();
}

function failing(id: string, t: Topology): string[] {
  const r = evaluate(t.toJSON(), missionRubric(missionById(id)!, 'es-ES'));
  return r.items.filter((i) => !i.passed).map((i) => `${i.id}: ${i.detail}`);
}

test('basico-linux: routers and domain-name-servers back in option-data, kea-dhcp4 -t, restart, renew', () => {
  const t = missionStart('basico-linux');
  const out = root(t, 'GW', `sed -i 's/"option-data": \\[/"option-data": [ { "name": "routers", "data": "192.168.10.1" }, { "name": "domain-name-servers", "data": "8.8.8.8" },/' /etc/kea/kea-dhcp4.conf
kea-dhcp4 -t /etc/kea/kea-dhcp4.conf >/dev/null; echo $?; systemctl restart kea-dhcp4-server; systemctl is-active kea-dhcp4-server`);
  assert.deepEqual(out, ['0', 'active']);
  renew(t, ['PC0', 'PC1', 'PC2']);
  assert.deepEqual(failing('basico-linux', t), []);
});

test('relay: SERVERS and the unit on EDGE, a netplan route back on DHCP-SRV, the PCs ask again', () => {
  const t = missionStart('relay');
  assert.deepEqual(root(t, 'EDGE', `sed -i 's/^SERVERS=.*/SERVERS="10.0.0.1"/' /etc/default/isc-dhcp-relay
systemctl enable --now isc-dhcp-relay >/dev/null 2>&1; systemctl is-active isc-dhcp-relay`), ['active']);
  root(t, 'DHCP-SRV', `cat > /etc/netplan/50-cloud-init.yaml <<'E'
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 10.0.0.1/30
      routes:
        - to: 10.20.0.0/24
          via: 10.0.0.2
E
netplan apply`);
  renew(t, ['PC0', 'PC1']);
  assert.deepEqual(failing('relay', t), []);
});

test('cliente: dhcp4 on CPE\'s eth0, the ISP\'s reservation with 01 + MAC and its gateway, netplan apply', () => {
  const t = missionStart('cliente');
  root(t, 'CPE', cpeNetplan(true)); // the file as nano leaves it: dhcp4: true under eth0 only (Netfix refuses it elsewhere)
  t.settle();
  assert.deepEqual(failing('cliente', t).map((f) => f.split(':')[0]), ['fixed', 'router', 'route'], 'task 1 alone');
  const isp = new Session(t.byLabel('ISP') as Router);
  isp.mode = 'exec';
  const auto = isp.input('show ip dhcp binding').find((l) => l.startsWith('100.64.0.') && !l.startsWith('100.64.0.77'));
  const id = auto?.trim().split(/\s+/)[1];
  assert.match(id ?? '', /^0100\./, 'the automatic lease shows 01 + MAC');
  for (const l of ['configure terminal', 'ip dhcp pool CPE-FIJO', 'no client-identifier', `client-identifier ${id}`, 'ip dhcp pool CLIENTES', 'default-router 100.64.0.1', 'end']) isp.input(l);
  root(t, 'CPE', 'netplan apply');
  t.settle();
  assert.deepEqual(failing('cliente', t), []);
});
