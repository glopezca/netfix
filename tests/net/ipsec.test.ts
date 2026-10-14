/** Site-to-site IPsec between two 2911: IKE, ESP tunnel, counters, mismatches and running-config. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { Session, applyConfig } from '../../src/ios/session.ts';
import type { IosDevice } from '../../src/ios/device.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';

function cli(d: IosDevice, mode: 'config' | 'exec', ...lines: string[]): string[] {
  const s = new Session(d);
  s.mode = mode;
  return lines.flatMap((l) => s.input(l));
}

const ip = (t: string): number => parseIp(t)!;

function vpn(r: Router, opts: { local: string; remote: string; peer: string; key: string; ts?: string; enc?: string }): string[] {
  return cli(r, 'config',
    'crypto isakmp policy 10', `encryption ${opts.enc ?? 'aes 256'}`, 'hash sha', 'authentication pre-share', 'group 5', 'exit',
    `crypto isakmp key ${opts.key} address ${opts.peer}`,
    `crypto ipsec transform-set TS ${opts.ts ?? 'esp-aes 256 esp-sha-hmac'}`, 'exit',
    `access-list 110 permit ip ${opts.local} 0.0.0.255 ${opts.remote} 0.0.0.255`,
    'crypto map VPN 10 ipsec-isakmp', `set peer ${opts.peer}`, 'set transform-set TS', 'match address 110', 'exit',
    'interface g0/1', 'crypto map VPN');
}

/** PC1 192.168.1.10 ─ R1 ─ 10.0.0.0/30 ─ R2 ─ PC2 192.168.2.10 */
function lab(): { t: Topology; r1: Router; r2: Router; pc1: Pc; pc2: Pc; logs1: string[]; logs2: string[] } {
  const t = new Topology();
  const r1 = t.add('router', 0, 0).device as Router;
  const r2 = t.add('router', 0, 0).device as Router;
  const pc1 = t.add('pc', 0, 0).device as Pc;
  const pc2 = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r1.id, port: 'GigabitEthernet0/0' }, { device: pc1.id, port: 'FastEthernet0' });
  t.connect({ device: r2.id, port: 'GigabitEthernet0/0' }, { device: pc2.id, port: 'FastEthernet0' });
  t.connect({ device: r1.id, port: 'GigabitEthernet0/1' }, { device: r2.id, port: 'GigabitEthernet0/1' });
  cli(r1, 'config', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2');
  cli(r2, 'config', 'interface g0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.0.1');
  pc1.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  pc2.setStatic({ ip: ip('192.168.2.10'), prefix: 24, gateway: ip('192.168.2.1') });
  t.settle();
  const logs1: string[] = [];
  const logs2: string[] = [];
  r1.onConsole((l) => logs1.push(l));
  r2.onConsole((l) => logs2.push(l));
  return { t, r1, r2, pc1, pc2, logs1, logs2 };
}

const ping = (pc: Pc, dst: string, n = 5): string => createShell(pc, 'linux').run(`ping -c ${n} ${dst}`).join('\n');
const received = (out: string): number => Number(/(\d+) received/.exec(out)?.[1] ?? -1);

test('crypto map config: modes, NOTE, ISAKMP ON and running-config', () => {
  const { r1, logs1 } = lab();
  const out = vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'cisco123' });
  assert.deepEqual(out, ['% NOTE: This new crypto map will remain disabled until a peer', '        and a valid access list have been configured.']);
  assert.ok(logs1.includes('%CRYPTO-6-ISAKMP_ON_OFF: ISAKMP is ON'));
  const run = cli(r1, 'exec', 'show running-config').join('\n');
  assert.match(run, /crypto isakmp policy 10\n encr aes 256\n authentication pre-share\n group 5\ncrypto isakmp key cisco123 address 10\.0\.0\.2\n!\n!\ncrypto ipsec transform-set TS esp-aes 256 esp-sha-hmac\n!\ncrypto map VPN 10 ipsec-isakmp \n set peer 10\.0\.0\.2\n set transform-set TS \n match address 110\n!/);
  assert.match(run, /interface GigabitEthernet0\/1\n ip address 10\.0\.0\.1 255\.255\.255\.252\n duplex auto\n speed auto\n crypto map VPN\n/);
  const s = new Session(r1);
  s.mode = 'config';
  s.input('crypto isakmp policy 20');
  assert.equal(s.prompt(), 'Router(config-isakmp)#');
  assert.deepEqual(cli(r1, 'config', 'crypto ipsec transform-set BAD esp-sha-hmac'), ['% Invalid input detected.']);
});

test('site-to-site tunnel: first packet lost to IKE, then ESP both ways with counters', () => {
  const { r1, r2, pc1, logs2 } = lab();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'cisco123' });
  vpn(r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'cisco123' });
  const out = ping(pc1, '192.168.2.10');
  assert.ok(received(out) >= 3 && received(out) < 5, out);
  assert.match(cli(r1, 'exec', 'show crypto isakmp sa').join('\n'), /10\.0\.0\.2\s+10\.0\.0\.1\s+QM_IDLE\s+1001 ACTIVE/);
  const sa = cli(r1, 'exec', 'show crypto ipsec sa').join('\n');
  assert.match(sa, /interface: GigabitEthernet0\/1\n {4}Crypto map tag: VPN, local addr 10\.0\.0\.1/);
  assert.match(sa, /local {2}ident \(addr\/mask\/prot\/port\): \(192\.168\.1\.0\/255\.255\.255\.0\/0\/0\)/);
  const encaps = Number(/#pkts encaps: (\d+)/.exec(sa)?.[1]);
  const decaps = Number(/#pkts decaps: (\d+)/.exec(sa)?.[1]);
  assert.equal(encaps, 4, 'every request but the one that started IKE (R2 may lose one more to ARP)');
  assert.equal(decaps, received(out), 'every reply that came back was decapsulated');
  assert.match(sa, /#send errors 1, #recv errors 0/);
  assert.match(sa, /transform: esp-aes 256 esp-sha-hmac ,/);
  assert.equal(received(ping(pc1, '192.168.2.10', 3)), 3, 'once up, nothing is lost');
  assert.match(cli(r2, 'exec', 'show crypto isakmp sa').join('\n'), /10\.0\.0\.2\s+10\.0\.0\.1\s+QM_IDLE/);
  assert.deepEqual(logs2.filter((l) => l.startsWith('%CRYPTO-4')), []);
  assert.match(cli(r1, 'exec', 'show crypto map').join('\n'), /Crypto Map VPN 10 ipsec-isakmp\n\tPeer = 10\.0\.0\.2\n\tExtended IP access list 110\n\t {4}10 permit ip 192\.168\.1\.0 0\.0\.0\.255 192\.168\.2\.0 0\.0\.0\.255/);
});

test('wrong pre-shared key: IKMP_BAD_MESSAGE and no tunnel', () => {
  const { r1, r2, pc1, logs1 } = lab();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'cisco123' });
  vpn(r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'otra' });
  assert.equal(received(ping(pc1, '192.168.2.10')), 0);
  assert.ok(logs1.some((l) => l === '%CRYPTO-4-IKMP_BAD_MESSAGE: IKE message from 10.0.0.2 failed its sanity check or is malformed'));
  assert.match(cli(r1, 'exec', 'show crypto isakmp sa').join('\n'), /MM_NO_STATE/);
});

test('policy or transform mismatch fails main / quick mode', () => {
  const a = lab();
  vpn(a.r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k', enc: '3des' });
  vpn(a.r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'k' });
  assert.equal(received(ping(a.pc1, '192.168.2.10', 3)), 0);
  assert.ok(a.logs2.includes('%CRYPTO-6-IKMP_MODE_FAILURE: Processing of Main mode failed with peer at 10.0.0.1'));
  const b = lab();
  vpn(b.r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k', ts: 'esp-3des esp-md5-hmac' });
  vpn(b.r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'k' });
  assert.equal(received(ping(b.pc1, '192.168.2.10', 3)), 0);
  assert.ok(b.logs2.includes('%CRYPTO-6-IKMP_MODE_FAILURE: Processing of Quick mode failed with peer at 10.0.0.1'));
  assert.ok(b.logs1.includes('%CRYPTO-6-IKMP_MODE_FAILURE: Processing of Quick mode failed with peer at 10.0.0.2'));
});

test('cleartext that should be protected is dropped once the SA exists; clear crypto sa resets', () => {
  const { r1, r2, pc1, pc2, logs1 } = lab();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k' });
  vpn(r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'k' });
  ping(pc1, '192.168.2.10', 3);
  cli(r2, 'config', 'interface g0/1', 'no crypto map VPN');
  assert.equal(received(ping(pc2, '192.168.1.10', 2)), 0);
  assert.ok(logs1.some((l) => l.startsWith("%CRYPTO-4-RECVD_PKT_NOT_IPSEC: Rec'd packet not an IPSEC packet. (ip) vrf/dest_addr= (none)/192.168.1.10, src_addr= 192.168.2.10, prot= 1")));
  cli(r1, 'exec', 'clear crypto sa', 'clear crypto isakmp');
  assert.doesNotMatch(cli(r1, 'exec', 'show crypto isakmp sa').join('\n'), /QM_IDLE/);
  assert.match(cli(r1, 'exec', 'show crypto ipsec sa').join('\n'), /#pkts encaps: 0/);
});

test('show crypto isakmp policy lists configured and default suites', () => {
  const { r1 } = lab();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k' });
  const out = cli(r1, 'exec', 'show crypto isakmp policy').join('\n');
  assert.match(out, /Protection suite of priority 10\n\tencryption algorithm:\tAES - Advanced Encryption Standard \(256 bit keys\)\.\n\thash algorithm:\t\tSecure Hash Standard\n\tauthentication method:\tPre-Shared Key\n\tDiffie-Hellman group:\t#5 \(1536 bit\)/);
  assert.match(out, /Default protection suite\n\tencryption algorithm:\tDES/);
});

test('the crypto block survives a running-config replay (save/load)', () => {
  const { r1 } = lab();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k', ts: 'esp-3des esp-md5-hmac' });
  cli(r1, 'config', 'crypto ipsec transform-set TS esp-3des esp-md5-hmac', 'mode transport');
  const fresh = lab().r1;
  applyConfig(fresh, r1.runningConfig());
  assert.deepEqual(fresh.crypto, r1.crypto);
  assert.equal(fresh.iface('GigabitEthernet0/1')?.cryptoMap, 'VPN');
});

test('a crypto ACL with several permit lines protects all of them', () => {
  const { t, r1, r2 } = lab();
  const pc3 = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r1.id, port: 'GigabitEthernet0/2' }, { device: pc3.id, port: 'FastEthernet0' });
  cli(r1, 'config', 'interface g0/2', 'ip address 192.168.3.1 255.255.255.0', 'no shutdown');
  pc3.setStatic({ ip: ip('192.168.3.10'), prefix: 24, gateway: ip('192.168.3.1') });
  t.settle();
  vpn(r1, { local: '192.168.1.0', remote: '192.168.2.0', peer: '10.0.0.2', key: 'k' });
  vpn(r2, { local: '192.168.2.0', remote: '192.168.1.0', peer: '10.0.0.1', key: 'k' });
  cli(r1, 'config', 'access-list 110 permit ip 192.168.3.0 0.0.0.255 192.168.2.0 0.0.0.255');
  cli(r2, 'config', 'access-list 110 permit ip 192.168.2.0 0.0.0.255 192.168.3.0 0.0.0.255');
  const out = ping(pc3, '192.168.2.10');
  assert.ok(received(out) >= 3, out);
  assert.match(cli(r2, 'exec', 'show crypto ipsec sa').join('\n'), /#pkts decaps: [1-9]/);
});

test('an empty access list applied to an interface permits everything (IOS)', () => {
  const { r1, pc1 } = lab();
  cli(r1, 'config', 'ip access-list extended VACIA', 'remark aun sin reglas', 'exit', 'interface g0/0', 'ip access-group VACIA in');
  assert.match(ping(pc1, '192.168.1.1', 2), / 0% packet loss/);
});
