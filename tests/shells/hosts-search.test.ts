/** /etc/hosts edited by root resolves names before DNS; netplan's nameservers.search gives a static host its search list. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { searchDomains, resolveHost } from '../../src/shells/net-tools.ts';
import type { Pc } from '../../src/devices/pc.ts';

const all = (lines: readonly string[]): string => lines.join('\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function lab(): { topo: Topology; pc: Pc } {
  const ex = EXAMPLES.find((e) => e.id === 'dns-reenvio');
  assert.ok(ex);
  const topo = ex.build();
  return { topo, pc: topo.byLabel('PC0') as Pc };
}

test('/etc/hosts: only root edits it; ping, ssh or the browser use it before DNS, nslookup and dig do not', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.match(all(sh.run("echo '192.168.50.2 aula-local' >> /etc/hosts")), /Permission denied/);
  sh.run("echo '192.168.50.2 aula-local aula' | sudo tee -a /etc/hosts > /dev/null");
  assert.match(all(sh.run('cat /etc/hosts')), /^192\.168\.50\.2 aula-local aula$/m);
  assert.match(all(sh.run('ping -c 1 aula')), /^PING aula \(192\.168\.50\.2\)/);
  assert.match(all(sh.run('nslookup aula-local')), /NXDOMAIN/, 'nslookup asks the DNS server only');
  assert.match(all(createShell(pc, 'windows').run('ping -n 1 aula-local')), /Pinging aula-local \[192\.168\.50\.2\]/);
});

test('hostname -f follows /etc/hosts; the edited file is saved with the topology', () => {
  const { topo, pc } = lab();
  const sh = createShell(pc, 'linux');
  sh.run("printf '127.0.0.1 localhost\\n127.0.1.1 pc0.empresa.lan pc0\\n' | sudo tee /etc/hosts > /dev/null");
  assert.equal(all(sh.run('hostname -f')), 'pc0.empresa.lan');
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(topo.toJSON())));
  const pc2 = back.byLabel('PC0') as Pc;
  assert.equal(all(createShell(pc2, 'linux').run('hostname -f')), 'pc0.empresa.lan');
});

test('netplan nameservers.search: a static host gets its search list, in resolv.conf and in the file', () => {
  const { topo, pc } = lab();
  const root = createShell(pc, 'linux', 'root');
  const fs = hostSystem(pc).fs;
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n  version: 2\n  ethernets:\n    eth0:\n      addresses: [192.168.50.150/24]\n      routes:\n        - to: default\n          via: 192.168.50.1\n      nameservers:\n        addresses: [192.168.50.2]\n        search: [empresa.lan, aula.lan]\n');
  assert.deepEqual(root.run('netplan apply; echo $?'), ['0']);
  assert.equal(pc.config.mode, 'static');
  assert.deepEqual(searchDomains(pc), ['empresa.lan', 'aula.lan']);
  assert.match(all(root.run('cat /etc/resolv.conf')), /^search empresa\.lan aula\.lan$/m);
  assert.match(all(root.run('ping -c 1 ns1')), /^PING ns1\.empresa\.lan \(192\.168\.50\.2\)/);
  pc.setStatic({ ...pc.config });
  assert.match(fs.readFile('/etc/netplan/50-cloud-init.yaml'), /search: \[empresa\.lan, aula\.lan\]/, 'the generated file keeps it');
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(topo.toJSON())));
  assert.deepEqual(searchDomains(back.byLabel('PC0') as Pc), ['empresa.lan', 'aula.lan']);
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n      nameservers:\n        search: [bad_domain!]\n');
  assert.match(all(root.run('netplan apply; echo $?')), /search domain.*bad_domain!/);
});

test('a saved /etc/hosts applies as soon as the topology loads, before the GNU/Linux system of the host is first used', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  pc.setStatic({ ip: 0x0a000001, prefix: 24 });
  hostSystem(pc).fs.writeFile('/etc/hosts', '10.0.0.9 nas\n', undefined, true);
  const loaded = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = loaded.byLabel('PC0') as Pc;
  assert.deepEqual(resolveHost(again, 'nas'), { kind: 'ip', ip: 0x0a000009, name: 'nas', viaDns: false });
});
