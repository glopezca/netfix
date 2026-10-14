/** VPN labs: what each lab allows and what it blocks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { formatIp } from '../../src/core/ip.ts';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const all = (l: string[]): string => l.join('\n');
const exec = (r: Router, ...lines: string[]): string => { const s = new Session(r); s.mode = 'exec'; return lines.flatMap((l) => s.input(l)).join('\n'); };
const pcsOf = (t: ReturnType<typeof lab>): Pc[] => [...t.placed.values()].map((p) => p.device).filter((d): d is Pc => d.kind === 'pc');

test('IPsec lab: LAN to LAN through the tunnel, Internet through NAT, nothing in clear', () => {
  const t = lab('vpn-ipsec');
  const a = t.byLabel('SEDE-A') as Router;
  const [pcA, , pcB] = pcsOf(t) as [Pc, Pc, Pc, Pc];
  assert.match(formatIp(pcB.config.ip ?? 0), /^192\.168\.20\./);
  const sh = createShell(pcA, 'linux');
  const first = all(sh.run(`ping -c 4 ${formatIp(pcB.config.ip ?? 0)}`));
  assert.match(first, /[1-3] received/, 'the first packet starts IKE');
  assert.match(all(sh.run(`ping -c 3 ${formatIp(pcB.config.ip ?? 0)}`)), / 0% packet loss/);
  assert.match(exec(a, 'show crypto isakmp sa'), /QM_IDLE\s+1001 ACTIVE/);
  assert.match(exec(a, 'show crypto ipsec sa'), /#pkts encaps: [1-9]/);
  assert.match(all(sh.run('ping -c 1 8.8.8.8')), / 0% packet loss/, 'Internet through NAT overload');
  assert.doesNotMatch(exec(a, 'show ip nat translations'), /192\.168\.20\./, 'LAN-to-LAN is exempt from NAT');
  const conf = new Session(a);
  conf.mode = 'config';
  ['interface g0/1', 'no crypto map VPN'].forEach((l) => conf.input(l));
  exec(a, 'clear crypto sa');
  assert.match(all(sh.run(`ping -c 2 ${formatIp(pcB.config.ip ?? 0)}`)), /100% packet loss/, 'without the tunnel the private networks are not reachable');
});

test('WireGuard lab: branch behind NAT reaches the hub, the hub learns its endpoint, WAN SSH is filtered', () => {
  const t = lab('vpn-wireguard');
  const hub = t.byLabel('CENTRAL') as LinuxRouter;
  const branch = t.byLabel('SUCURSAL') as LinuxRouter;
  const pcs = pcsOf(t);
  const branchPc = pcs.find((p) => formatIp(p.config.ip ?? 0) === '10.2.0.10')!;
  assert.match(all(createShell(branchPc, 'linux').run('ping -c 3 10.1.0.10')), / 0% packet loss/);
  const root = createShell(hub, 'linux', 'root');
  assert.match(all(root.run('wg show wg0 endpoints')), /\t\d+\.\d+\.\d+\.\d+:\d+$/, 'endpoint learned through the NAT');
  assert.match(all(root.run('systemctl is-active nftables wg-quick@wg0')), /active/);
  const hubPublic = formatIp(hub.config.ip ?? 0);
  const b = createShell(branch, 'linux', 'root');
  assert.match(all(b.run(`nc -z -w 1 ${hubPublic} 22 2>&1`)), /timed out/, 'SSH from the Internet is dropped');
  assert.match(all(b.run('nc -zv -w 1 10.99.0.1 22 2>&1')), /succeeded/, 'SSH through the tunnel is allowed');
  assert.match(all(createShell(branchPc, 'linux').run('ping -c 1 8.8.8.8')), / 0% packet loss/, 'Internet through the operator NAT');
});
