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
    const sh = createShell(pc, 'linux');
    assert.deepEqual(sh.run('ping -c 2 192.168.2.10'), [], 'nothing yet: the replies have not come');
    assert.equal(sh.prompt(), '', 'no prompt while it waits');
    assert.match(await rest(() => sh.later?.() ?? null), /2 packets transmitted, 2 received/);
    assert.notEqual(sh.prompt(), '');
    sh.run('curl -s -o /dev/null -w "%{http_code}" http://192.168.2.10/; echo " rc=$?"');
    assert.match(await rest(() => sh.later?.() ?? null), /200 rc=0/);
  } finally {
    stop();
  }
});

test('Ctrl+C while waiting live: the prompt comes back and the late reply prints nothing', async () => {
  const { t, pc } = lab(true);
  const stop = clock(t);
  try {
    const sh = createShell(pc, 'linux');
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
    const win = createShell(pc, 'windows');
    assert.match(win.run('ping -n 2 192.168.2.10').join('\n'), /Pinging 192\.168\.2\.10/, 'the header at once');
    assert.match(await rest(() => win.later?.() ?? null), /Received = 2, Lost = 0/);
    win.run('curl http://192.168.2.10/');
    assert.match(await rest(() => win.later?.() ?? null), /<html|<!DOCTYPE/i);
    const ios = new Session(r);
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
