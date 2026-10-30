/**
 * LLMNR (RFC 4795), built into Windows: a single-label name the DNS does not know is asked by multicast to
 * 224.0.0.252:5355 (TTL 1, never routed) at the same time as NetBIOS; the Windows host whose name it is answers unicast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { frameProtocol } from '../../src/net/packets.ts';
import { formatIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');

test('Windows asks a bare name by LLMNR (and NBNS at once); the owner answers unicast from 5355', () => {
  const t = lab('basico');
  const [pc0, pc2] = [t.byLabel('PC0') as Host, t.byLabel('PC2') as Host];
  const before = t.net.history.length;
  assert.match(win(pc0, 'ping -n 1 pc2'), /Pinging pc2 \[[\d.]+\] with 32 bytes of data:\n\nReply from /);
  const events = t.net.history.slice(before);
  const llmnr = events.filter((e) => frameProtocol(e.frame) === 'LLMNR');
  const query = llmnr.find((e) => !e.frame.ip?.udp?.dns?.response);
  assert.ok(query, 'an LLMNR question');
  assert.equal(formatIp(query.frame.ip?.dst ?? 0), '224.0.0.252');
  assert.equal(query.frame.dst, '01005e0000fc');
  assert.equal(query.frame.ip?.ttl, 1);
  assert.equal(query.frame.ip?.udp?.dport, 5355);
  assert.equal(query.frame.ip?.udp?.dns?.qname, 'pc2');
  const answer = llmnr.find((e) => e.frame.ip?.udp?.dns?.response);
  assert.equal(answer?.frame.ip?.udp?.sport, 5355);
  assert.equal(answer?.frame.ip?.src, pc2.config.ip, 'unicast from the owner');
  assert.equal(answer?.frame.ip?.udp?.dns?.answers?.[0]?.data, formatIp(pc2.config.ip ?? 0));
  assert.ok(events.some((e) => frameProtocol(e.frame) === 'NBNS'), 'NetBIOS goes at the same time');
});

test('LLMNR is case-insensitive, only for single labels, and a GNU/Linux host does not answer it', () => {
  const t = lab('basico');
  const pc0 = t.byLabel('PC0') as Host;
  assert.match(win(pc0, 'ping -n 1 PC2'), /Reply from /);
  const before = t.net.history.length;
  win(pc0, 'ping -n 1 pc2.ejemplo.lab');
  assert.ok(!t.net.history.slice(before).some((e) => frameProtocol(e.frame) === 'LLMNR'), 'a name with dots goes only to the DNS');
  assert.match(win(pc0, 'ping -n 1 pc1'), /could not find host pc1/, 'PC1 is GNU/Linux without samba');
});

test('LLMNR does not cross routers', () => {
  const t = lab('internet');
  const pc0 = t.byLabel('PC0') as Host;
  const before = t.net.history.length;
  assert.match(win(pc0, 'ping -n 1 srv-sede2'), /could not find host srv-sede2/);
  const llmnr = t.net.history.slice(before).filter((e) => frameProtocol(e.frame) === 'LLMNR');
  assert.ok(llmnr.length > 0, 'asked on its own link');
  assert.ok(!llmnr.some((e) => e.frame.ip?.udp?.dns?.response), 'nobody answers beyond the router');
});

test('without an answer Windows asks LLMNR twice, 410 ms apart', () => {
  const t = lab('basico');
  const pc0 = t.byLabel('PC0') as Host;
  const before = t.net.history.length;
  win(pc0, 'ping -n 1 nadie');
  const sent = t.net.history.slice(before).filter((e) => frameProtocol(e.frame) === 'LLMNR' && e.from.device === pc0.id);
  assert.equal(sent.length, 2);
  assert.equal((sent[1]?.time ?? 0) - (sent[0]?.time ?? 0), 410);
});
