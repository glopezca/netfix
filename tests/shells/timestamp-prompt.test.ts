/**
 * «Prompt con marca de fecha y hora»: a device setting that sets PS1 in the Linux terminal (as the statement
 * PS1="\[\e[32m\]\d \[\e[36m\]\A \[\e[33m\]\u@\h:\w\$ \[\e[0m\]" would) and the PowerShell-style prompt in the Windows
 * terminal; saved with the topology and, when a classroom locks it, forced on every device and SSH session.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { LINUX_TIMESTAMP_PS1, forceTimestampPrompt, setTimestampPrompt, timestampPromptOn } from '../../src/shells/prompt-clock.ts';
import { parseIp } from '../../src/core/ip.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const DATE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} /;

function lab(): { t: Topology; pc: Pc; srv: Server } {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'ana', password: 'ana1' }] } });
  t.settle();
  return { t, pc, srv };
}

afterEach(() => forceTimestampPrompt(undefined));

test('Linux: the statement PS1 with colours, date (\\d), time (\\A), user@host:cwd and $', () => {
  assert.equal(LINUX_TIMESTAMP_PS1, '\\[\\e[32m\\]\\d \\[\\e[36m\\]\\A \\[\\e[33m\\]\\u@\\h:\\w\\$ \\[\\e[0m\\]');
  const { pc } = lab();
  setTimestampPrompt(pc, true);
  const sh = createShell(pc, 'linux');
  const prompt = sh.prompt();
  assert.match(prompt, /^\x1b\[32m[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \x1b\[36m\d{2}:\d{2} \x1b\[33m\w+@pc0:~\$ \x1b\[0m$/);
  assert.match(sh.run('echo "$PS1"').join('\n'), /^\\\[\\e\[32m\\\]\\d /, 'it is the PS1 variable, as if typed');
  sh.run('cd /etc');
  assert.match(plain(sh.prompt()), /@pc0:\/etc\$ $/);
});

test('Linux: unticking brings back the PS1 there was; a new session and root (#) follow the setting', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  const before = sh.run('echo "$PS1"').join('\n');
  setTimestampPrompt(pc, true);
  sh.applyTimestampPrompt?.();
  assert.match(plain(sh.prompt()), DATE);
  setTimestampPrompt(pc, false);
  sh.applyTimestampPrompt?.();
  assert.equal(sh.run('echo "$PS1"').join('\n'), before);
  setTimestampPrompt(pc, true);
  sh.applyTimestampPrompt?.();
  sh.run('exit');
  assert.match(plain(sh.prompt()), DATE, 'the session that replaces the closed one');
  assert.match(plain(createShell(pc, 'linux', 'root').prompt()), /root@pc0:~# $/);
});

test('Linux: a PS1 set by hand afterwards is kept when unticking', () => {
  const { pc } = lab();
  setTimestampPrompt(pc, true);
  const sh = createShell(pc, 'linux');
  sh.run("PS1='mio> '");
  setTimestampPrompt(pc, false);
  sh.applyTimestampPrompt?.();
  assert.equal(sh.prompt(), 'mio> ');
});

test('Windows: the PowerShell prompt function: date, time, user@host, path and $', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'windows');
  const normal = sh.prompt();
  setTimestampPrompt(pc, true);
  const p = sh.prompt();
  assert.match(p, /^\x1b\[36m[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \x1b\[92m\w+@pc0\x1b\[97m \x1b\[93mC:\\[^\x1b]*\x1b\[0m\$ $/);
  assert.ok(plain(p).includes(normal.replace(/>$/, '')), `${plain(p)} shows the current path ${normal}`);
  setTimestampPrompt(pc, false);
  assert.equal(sh.prompt(), normal);
});

test('the setting is saved with the topology, per device', () => {
  const { t, pc, srv } = lab();
  setTimestampPrompt(srv, true);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const devices = [...again.placed.values()].map((p) => p.device);
  assert.equal(timestampPromptOn(devices.find((d) => d.kind === 'server') as Server), true);
  assert.equal(timestampPromptOn(devices.find((d) => d.kind === 'pc') as Pc), false);
  assert.equal(timestampPromptOn(pc), false);
});

test('a classroom lock forces it on every device, also in SSH sessions; off wins over the device setting', () => {
  const { pc, srv } = lab();
  forceTimestampPrompt(true);
  const sh = createShell(pc, 'linux');
  assert.match(plain(sh.prompt()), DATE);
  sh.run('ssh ana@10.0.0.2');
  sh.run('yes');
  sh.run('ana1');
  assert.match(plain(sh.prompt()), /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2} ana@server0:~\$ $/, 'the remote shell of the server');
  forceTimestampPrompt(false);
  setTimestampPrompt(srv, true);
  assert.doesNotMatch(plain(createShell(srv, 'linux').prompt()), DATE);
  assert.doesNotMatch(plain(createShell(srv, 'windows').prompt()), DATE);
});
