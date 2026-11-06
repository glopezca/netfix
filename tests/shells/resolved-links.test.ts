/**
 * systemd-resolved on the network: with LLMNR=yes (or MulticastDNS=yes) in resolved.conf and on the link, a GNU/Linux
 * host answers for its name and asks by LLMNR or mDNS itself (`resolvectl query` names the protocol). «resolve» asks
 * without answering; a stopped unit does neither. The NSS source `resolve` (libnss-resolve) is how ping gets there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { frameProtocol } from '../../src/net/packets.ts';
import { formatIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Topology } from '../../src/net/topology.ts';
import { setPackageInstalled } from '../../src/net/host-packages.ts';
import { resolveHost } from '../../src/shells/net-tools.ts';

const run = (h: Host, cmd: string, user?: string): string => createShell(h, h.os === 'windows' ? 'windows' : 'linux', user).run(cmd).join('\n');
const conf = (h: Host, body: string): string => run(h, `printf '[Resolve]\\n${body}\\n' > /etc/systemd/resolved.conf; systemctl restart systemd-resolved`, 'root');
const re = (ip: number | undefined): string => formatIp(ip ?? 0).replace(/\./g, '\\.');

/** basico: PC0 Windows, PC1 and PC2 GNU/Linux on one LAN. */
function lab(): { t: Topology; pc0: Host; pc1: Host; pc2: Host } {
  const t = EXAMPLES.find((e) => e.id === 'basico')!.build();
  const [pc0, pc1, pc2] = ['PC0', 'PC1', 'PC2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  pc2.os = 'linux';
  return { t, pc0, pc1, pc2 };
}

test('LLMNR=yes: Windows finds the GNU/Linux host by LLMNR; it answers unicast from 5355', () => {
  const { t, pc0, pc1 } = lab();
  assert.match(run(pc0, 'ping -n 1 pc1'), /could not find host pc1/, 'Ubuntu ships LLMNR off');
  conf(pc1, 'LLMNR=yes');
  const before = t.net.history.length;
  assert.match(run(pc0, 'ping -n 1 pc1'), new RegExp(`Pinging pc1 \\[${re(pc1.config.ip)}\\]`));
  const answer = t.net.history.slice(before).find((e) => frameProtocol(e.frame) === 'LLMNR' && e.frame.ip?.udp?.dns?.response);
  assert.equal(answer?.frame.ip?.src, pc1.config.ip);
  assert.equal(answer?.frame.ip?.udp?.sport, 5355);
});

test('resolvectl query: a single label by LLMNR, a .local name by mDNS, each with its protocol', () => {
  const { pc0, pc1, pc2 } = lab();
  conf(pc1, 'LLMNR=yes');
  conf(pc2, 'LLMNR=yes');
  const out = run(pc1, 'resolvectl query pc2');
  assert.match(out, new RegExp(`^pc2: ${re(pc2.config.ip)} +-- link: eth0$`, 'm'));
  assert.match(out, /^-- Information acquired via protocol LLMNR\/IPv4 in \d/m);
  assert.match(out, /^-- Data from: network$/m);
  assert.match(run(pc1, 'resolvectl query pc0'), /protocol LLMNR\/IPv4/, 'Windows answers LLMNR too');
  assert.equal(run(pc1, 'resolvectl query pc0.local 2>&1'), 'pc0.local: resolve call failed: No appropriate name servers or networks for name found', 'no mDNS scope');
  conf(pc1, 'LLMNR=yes\\nMulticastDNS=yes');
  run(pc1, 'resolvectl mdns eth0 yes', 'root');
  const mdns = run(pc1, 'resolvectl query pc0.local');
  assert.match(mdns, new RegExp(`^pc0\\.local: ${re(pc0.config.ip)} +-- link: eth0$`, 'm'));
  assert.match(mdns, /protocol mDNS\/IPv4/);
  assert.match(run(pc1, 'resolvectl query nadie 2>&1; echo $?'), /^nadie: resolve call failed: All attempts to contact name servers or networks failed\n1$/, 'LLMNR asked, nobody answered; no search list: no DNS');
});

test('LLMNR=resolve asks but does not answer; a stopped resolved neither asks nor answers', () => {
  const { pc0, pc1, pc2 } = lab();
  conf(pc2, 'LLMNR=yes');
  conf(pc1, 'LLMNR=resolve');
  assert.match(run(pc1, 'resolvectl query pc2'), /protocol LLMNR\/IPv4/);
  assert.match(run(pc0, 'ping -n 1 pc1'), /could not find host pc1/);
  run(pc2, 'systemctl stop systemd-resolved', 'root');
  assert.match(run(pc0, 'ping -n 1 pc2'), /could not find host pc2/, 'nobody answers for pc2');
  run(pc2, 'systemctl start systemd-resolved', 'root');
  assert.match(run(pc0, 'ping -n 1 pc2'), /Pinging pc2 \[/);
  run(pc1, 'resolvectl llmnr eth0 no', 'root');
  assert.equal(run(pc1, 'resolvectl query pc2 2>&1'), 'pc2: resolve call failed: All attempts to contact name servers or networks failed', 'no LLMNR scope: pc2.aula.lab by DNS (8.8.8.8 is out of reach)');
  run(pc1, 'resolvectl domain eth0 ""', 'root');
  assert.equal(run(pc1, 'resolvectl query pc2 2>&1'), 'pc2: resolve call failed: No appropriate name servers or networks for name found', 'no LLMNR scope, no search list: never bare to the DNS');
});

test('the Linux question goes to 224.0.0.252 with TTL 1, from the link it has a scope on', () => {
  const { t, pc1, pc2 } = lab();
  conf(pc1, 'LLMNR=yes');
  conf(pc2, 'LLMNR=yes');
  const before = t.net.history.length;
  run(pc1, 'resolvectl query pc2');
  const q = t.net.history.slice(before).find((e) => frameProtocol(e.frame) === 'LLMNR' && !e.frame.ip?.udp?.dns?.response);
  assert.equal(formatIp(q?.frame.ip?.dst ?? 0), '224.0.0.252');
  assert.equal(q?.frame.ip?.ttl, 1);
  assert.equal(q?.frame.ip?.src, pc1.config.ip);
});

test('NSS: ping uses LLMNR only through libnss-resolve; with resolved stopped, resolve is UNAVAIL and dns follows', () => {
  const { pc1, pc2 } = lab();
  conf(pc1, 'LLMNR=yes');
  conf(pc2, 'LLMNR=yes');
  assert.match(run(pc1, 'ping -c 1 pc2 2>&1'), /ping: pc2: (Name or service not known|Temporary failure in name resolution)/, 'files dns: no LLMNR');
  setPackageInstalled(pc1, 'libnss-resolve', true);
  run(pc1, "sed -i 's/^hosts:.*/hosts:          files resolve [!UNAVAIL=return] dns/' /etc/nsswitch.conf", 'root');
  const r = resolveHost(pc1, 'pc2');
  assert.equal(r.kind === 'ip' ? r.ip : undefined, pc2.config.ip, 'resolve answers by LLMNR');
  assert.match(run(pc1, 'ping -c 1 pc2'), new RegExp(`^PING pc2 \\(${re(pc2.config.ip)}\\)`, 'm'));
  run(pc1, 'systemctl stop systemd-resolved', 'root');
  assert.equal(resolveHost(pc1, 'pc2').kind, 'error', 'UNAVAIL: glibc goes on to dns, which does not know pc2');
});
