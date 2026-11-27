/**
 * Live waits (0.92.0): a network that reaches out of the page (a host's device linked to other pages) gets its replies in
 * later tasks of the browser, so its clients wait in real time while the page's clock moves the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Router } from '../../src/devices/router.ts';
import { Session } from '../../src/ios/session.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import { runLive, runSteps } from '../../src/net/live-wait.ts';

const ip = (t: string): number => parseIp(t)!;

/** A PC and a web server on a router; `outside` marks the network as reaching out of the page. */
function lab(outside: boolean): { t: Topology; pc: Pc; srv: Server; r: Router } {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  const r = t.add('router', 0, 0).device as Router;
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/1' });
  const s = new Session(r);
  s.mode = 'config';
  for (const l of ['interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'end']) s.input(l);
  pc.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  srv.setStatic({ ip: ip('192.168.2.10'), prefix: 24, gateway: ip('192.168.2.1') });
  t.settle();
  createShell(pc, 'linux').run('ping -c 1 192.168.2.10'); // ARP learned, as after a first ping
  if (outside) Object.assign(srv, { reachesOutside: () => true });
  return { t, pc, srv, r };
}

/** The page's clock: the network advances in real time, as the real-time lab's tick does. */
function clock(t: Topology): () => void {
  const timer = setInterval(() => t.net.runFor(20), 20);
  return () => clearInterval(timer);
}

/** A terminal window's shell: it prints a live wait's output later, so it opts in (0.92.0). */
function terminal(pc: Pc, os: 'linux' | 'windows'): ReturnType<typeof createShell> {
  const sh = createShell(pc, os);
  sh.liveWaits = true;
  return sh;
}

/** Everything a shell prints after a live wait (one wait may end in another: ping's next packet). */
async function rest(later: () => Promise<string[]> | null): Promise<string> {
  let out: string[] = [];
  for (let p = later(); p; p = later()) out = [...out, ...await p];
  return out.join('\n');
}

test('a network all in the page: replies are fast-forwarded, the output comes at once, nothing waits', () => {
  const { pc, t } = lab(false);
  assert.equal(t.net.reachesOutside(), false);
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('ping -c 2 192.168.2.10').join('\n'), /2 received/);
  assert.equal(sh.later?.() ?? null, null);
});

test('Linux terminal, reaching out: ping and curl wait live, no prompt meanwhile, then their output', async () => {
  const { t, pc } = lab(true);
  assert.equal(t.net.reachesOutside(), true);
  const stop = clock(t);
  try {
    const sh = terminal(pc, 'linux');
    assert.deepEqual(sh.run('ping -c 2 192.168.2.10'), [], 'nothing yet: the replies have not come');
    assert.equal(sh.prompt(), '', 'no prompt while it waits');
    assert.match(await rest(() => sh.later?.() ?? null), /2 packets transmitted, 2 received/);
    assert.notEqual(sh.prompt(), '');
    sh.run('curl -s -o /dev/null -w "%{http_code}" http://192.168.2.10/; echo " rc=$?"');
    assert.match(await rest(() => sh.later?.() ?? null), /200 rc=0/);
    // Driven synchronously inside $(…): the wait fast-forwards, as before (review: it used to be skipped).
    assert.match(sh.run('x=$(curl -s -o /dev/null -w "%{http_code}" http://192.168.2.10/); echo "got=$x"').join('\n'), /got=200/);
    assert.equal(sh.later?.() ?? null, null);
  } finally {
    stop();
  }
});

test('Ctrl+C while waiting live: the prompt comes back and the late reply prints nothing', async () => {
  const { t, pc } = lab(true);
  const stop = clock(t);
  try {
    const sh = terminal(pc, 'linux');
    sh.run('ping -c 4 192.168.2.10');
    const pending = sh.later?.();
    sh.interrupt?.();
    assert.notEqual(sh.prompt(), '', 'the prompt is back at once');
    assert.deepEqual(await pending, []);
  } finally {
    stop();
  }
});

test('Windows prompt, IOS console and the browser wait live too', async () => {
  const { t, pc, r } = lab(true);
  const stop = clock(t);
  try {
    const win = terminal(pc, 'windows');
    assert.deepEqual(win.run('ping -n 2 192.168.2.10'), [], 'the name may be looked up live too (0.94.0): all of it later');
    assert.match(await rest(() => win.later?.() ?? null), /Pinging 192\.168\.2\.10[\s\S]*Received = 2, Lost = 0/);
    win.run('tracert nada.invalid');
    assert.match(await rest(() => win.later?.() ?? null), /Unable to resolve target system name/);
    assert.match(win.run('echo %errorlevel%').join('\n'), /^1$/m, 'errorlevel from the live command\'s output (review)');
    win.run('curl http://192.168.2.10/');
    assert.match(await rest(() => win.later?.() ?? null), /<html|<!DOCTYPE/i);
    const ios = new Session(r);
    ios.liveWaits = true;
    ios.mode = 'exec';
    assert.deepEqual(ios.input('ping 192.168.2.10'), []);
    assert.equal(ios.prompt(), '');
    assert.match(await rest(() => ios.later()), /Success rate is 100 percent \(5\/5\)/);
    const web = new BrowserEngine(pc);
    assert.equal(web.live(), true);
    const page = await web.openLive('http://192.168.2.10/');
    assert.equal(page.kind === 'page' ? page.response.status : page.kind, 200);
  } finally {
    stop();
  }
});

test('callers that are not a terminal window stay synchronous: checks, ssh, a pipe, a redirection, a filter', async () => {
  const { t, pc, r } = lab(true);
  const stop = clock(t);
  try {
    assert.match(createShell(pc, 'linux').run('ping -c 2 192.168.2.10').join('\n'), /2 received/, 'a shell nobody opted in');
    const ios = new Session(r);
    ios.mode = 'exec';
    assert.match(ios.input('ping 192.168.2.10').join('\n'), /Success rate is 100 percent/, 'an IOS session for a web page or a check');
    const win = terminal(pc, 'windows');
    win.run('ping -n 1 192.168.2.10 > out.txt');
    assert.equal(win.later?.() ?? null, null, 'a redirection gets the whole output at once');
    assert.match(win.run('type out.txt').join('\n'), /Received = 1/);
    assert.match(win.run('ping -n 1 192.168.2.10 | find "TTL"').join('\n'), /TTL=/);
  } finally {
    stop();
  }
});

test('Ctrl+C in the Windows prompt and the IOS console: the late report is dropped', async () => {
  const { t, pc, r } = lab(true);
  const stop = clock(t);
  try {
    const win = terminal(pc, 'windows');
    win.run('ping -n 4 192.168.2.10');
    const late = win.later?.();
    win.interrupt?.();
    assert.deepEqual(await late, []);
    // An interrupted nslookup does not come back as a session when its answer arrives (review).
    win.run('nslookup');
    const nsLate = win.later?.();
    win.interrupt?.();
    await nsLate;
    assert.match(win.prompt(), /^C:\\/, 'the prompt, not nslookup\'s `>`');
    const ios = new Session(r);
    ios.liveWaits = true;
    ios.mode = 'exec';
    ios.input('ping 192.168.2.10');
    const iosLate = ios.later();
    assert.deepEqual(ios.interrupt(), []);
    assert.notEqual(ios.prompt(), '', 'the prompt is back');
    assert.deepEqual(await iosLate, []);
  } finally {
    stop();
  }
});

test('ssh from a terminal waits live (0.93.0): login, password, a remote command, exit', async () => {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const t = EXAMPLES.find((e) => e.id === 'ssh-sftp')!.build();
  Object.assign(t.byLabel('SRV') as Server, { reachesOutside: () => true });
  const stop = clock(t);
  try {
    const sh = terminal(t.byLabel('PC1') as Pc, 'linux');
    assert.deepEqual(sh.run('ssh -o StrictHostKeyChecking=accept-new ana@172.20.0.10'), [], 'the server has not answered yet');
    assert.match(await rest(() => sh.later?.() ?? null), /Permanently added '172\.20\.0\.10'/);
    assert.match(sh.prompt(), /ana@172\.20\.0\.10's password: $/);
    sh.run('ana1');
    await rest(() => sh.later?.() ?? null);
    assert.match(sh.prompt(), /ana@/, 'the remote prompt');
    sh.run('whoami');
    assert.equal(await rest(() => sh.later?.() ?? null), 'ana');
    sh.run('exit');
    assert.match(await rest(() => sh.later?.() ?? null), /Connection to 172\.20\.0\.10 closed/);
    assert.doesNotMatch(sh.prompt(), /^ana@/, 'back in the local shell');
    const once = createShell(t.byLabel('PC1') as Pc, 'linux');
    once.run('ssh -o StrictHostKeyChecking=accept-new ana@172.20.0.10');
    assert.match(once.prompt(), /password: $/, 'a shell nobody opted in stays synchronous');
  } finally {
    stop();
  }
});

/** Times differ between a fast-forwarded and a live run: «12.3 ms», «at 2026-11-27 10:00», «in 1.02 seconds». */
const untimed = (text: string): string => text.replace(/\d+\.\d+ ms/g, 'T ms').replace(/ at \d{4}-\d\d-\d\d \d\d:\d\d/g, ' at D').replace(/in \d+\.\d+ seconds/g, 'in T seconds').replace(/ in \d+(?:\.\d+)?(?:us|ms|s)\./g, ' in T.');

/** A command in a terminal, all its output: synchronously (nobody opted in), or live with the page's clock running. */
async function both(id: string, label: string, os: 'linux' | 'windows', cmd: string): Promise<{ sync: string; live: string }> {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const build = (): Topology => EXAMPLES.find((e) => e.id === id)!.build();
  const a = build();
  const sync = createShell(a.byLabel(label) as Pc, os).run(cmd).join('\n');
  const b = build();
  for (const p of b.placed.values()) if (p.label !== label) Object.assign(p.device, { reachesOutside: () => true });
  const stop = clock(b);
  try {
    const sh = terminal(b.byLabel(label) as Pc, os);
    const first = sh.run(cmd);
    return { sync: untimed(sync).trimEnd(), live: untimed([...first, await rest(() => sh.later?.() ?? null)].join('\n')).trimEnd() };
  } finally {
    stop();
  }
}

test('0.94.0: every other client waits live and prints what it printed before — DNS tools, names, scans, NetBIOS, SMB', async () => {
  const cases: [string, string, 'linux' | 'windows', string][] = [
    ['servidores', 'PC1', 'linux', 'host www.aula.lab'],
    ['servidores', 'PC1', 'linux', 'dig www.aula.lab +short'],
    ['servidores', 'PC1', 'linux', 'nslookup www.aula.lab'],
    ['servidores', 'PC1', 'linux', 'getent hosts www.aula.lab'],
    ['servidores', 'PC1', 'linux', 'resolvectl query www.aula.lab'],
    ['servidores', 'PC1', 'linux', 'ping -c 1 www.aula.lab'],
    ['servidores', 'PC1', 'linux', 'curl -s -o /dev/null -w "%{http_code}" http://www.aula.lab/'],
    ['servidores', 'PC1', 'linux', 'nmap -p 22,80,443 192.168.10.2'],
    ['servidores', 'PC1', 'linux', 'nc -zv 192.168.10.2 80'],
    ['servidores', 'PC1', 'windows', 'nslookup www.aula.lab'],
    ['servidores', 'PC1', 'windows', 'ping -n 1 www.aula.lab'],
    ['samba', 'PC0', 'windows', 'net view \\\\SRV'],
    ['samba', 'PC0', 'windows', 'nbtstat -a SRV'],
  ];
  for (const [id, label, os, cmd] of cases) {
    const r = await both(id, label, os, cmd);
    assert.equal(r.live, r.sync, `${id} ${label} ${os}: ${cmd}`);
  }
  const trace = await both('servidores', 'PC1', 'linux', 'traceroute -n 8.8.8.8');
  assert.equal(trace.live.split('\n').length, trace.sync.split('\n').length, 'traceroute: the same hops');
});

test('0.94.0: sftp from a terminal and the PC apps (mail, SFTP) wait live too', async () => {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const { drive } = await import('../../src/net/live-wait.ts');
  const { FileTransfer } = await import('../../src/clients/file-transfer.ts');
  const t = EXAMPLES.find((e) => e.id === 'ssh-sftp')!.build();
  Object.assign(t.byLabel('SRV') as Server, { reachesOutside: () => true });
  const stop = clock(t);
  try {
    const pc = t.byLabel('PC1') as Pc;
    const sh = terminal(pc, 'linux');
    sh.run('sftp -o StrictHostKeyChecking=accept-new ana@172.20.0.10');
    await rest(() => sh.later?.() ?? null);
    assert.match(sh.prompt(), /password: $/);
    sh.run('ana1');
    assert.match(await rest(() => sh.later?.() ?? null), /Connected to 172\.20\.0\.10/);
    sh.run('ls');
    assert.match(await rest(() => sh.later?.() ?? null), /bienvenida\.txt/);
    sh.run('bye');
    await rest(() => sh.later?.() ?? null);
    const { hostSystem, hostUsers } = await import('../../src/shells/host-system.ts');
    const ft = new FileTransfer(pc, hostSystem(pc).fs, hostUsers(pc).find((u) => u.name === 'alumno')!);
    assert.equal(await drive(pc.hooks, ft.connectSteps({ host: '172.20.0.10', port: 22, user: 'ana', password: 'ana1' }, { hostKey: () => true, passphrase: () => null })), true);
    assert.ok((await drive(pc.hooks, ft.remoteListSteps())).some((e) => e.name === 'bienvenida.txt'), 'the SFTP app lists the server live');
  } finally {
    stop();
  }
});

test('0.95.0: a Windows mapped drive on a server outside the page — net use, dir, >, type, md, copy, cd, Z:, del with Y', async () => {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const lines = ['net use Z: \\\\SRV\\publico', 'dir Z:', 'echo hola > Z:\\x.txt', 'type Z:\\x.txt', 'md Z:\\d', 'copy Z:\\x.txt Z:\\d', 'cd Z:\\d', 'Z:', 'dir', 'del Z:\\d\\*', 'Y', 'dir Z:\\d'];
  const clockOf = (text: string): string => untimed(text).replace(/\d\d\/\d\d\/\d{4} {2}\d\d:\d\d [AP]M/g, 'DATE');
  const a = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const sync = createShell(a.byLabel('PC0') as Pc, 'windows');
  const expected = lines.map((l) => clockOf(sync.run(l).join('\n')));
  const b = EXAMPLES.find((e) => e.id === 'samba')!.build();
  Object.assign(b.byLabel('SRV') as Server, { reachesOutside: () => true });
  const stop = clock(b);
  try {
    const win = terminal(b.byLabel('PC0') as Pc, 'windows');
    for (const [i, l] of lines.entries()) {
      const out = [...win.run(l), await rest(() => win.later?.() ?? null)].join('\n').replace(/\n$/, '');
      assert.equal(clockOf(out).trimEnd(), expected[i]?.trimEnd(), l);
    }
    assert.match(win.prompt(), /^Z:\\d>/, 'the current folder followed cd and Z:');
  } finally {
    stop();
  }
});

test('steps: the same client driven synchronously or live gives the same result', async () => {
  function* twoWaits(): Generator<{ done: () => boolean; ms: number }, number, void> {
    let n = 0;
    yield { done: () => { n++; return true; }, ms: 10 };
    yield { done: () => false, ms: 5 };
    return n;
  }
  assert.equal(runSteps({ runUntil: (done) => done() }, twoWaits()), 1);
  assert.equal(await runLive(twoWaits()), 1);
});
