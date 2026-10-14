/** VPN (WireGuard) of the Linux router from the web admin and the shared save code of the Services tab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import { genKey, pubKey } from '../../src/core/x25519.ts';
import { saveVpn, setVpnActive, vpnFileText, vpnStatus, VPN_CONF } from '../../src/shells/vpn-save.ts';
import { hostSystem } from '../../src/shells/host-system.ts';

function lab(): { lr: LinuxRouter; web: BrowserEngine } {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  createShell(lr, 'linux', 'root').run('ip addr add 192.168.1.1/24 dev eth1');
  pc.setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24 });
  lr.setServices({ ...lr.services, webapps: { ...lr.services.webapps, admin: { ...lr.services.webapps.admin, enabled: true } } });
  t.settle();
  return { lr, web: new BrowserEngine(pc) };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const URL = 'http://192.168.1.1:10000/';
const post = (web: BrowserEngine, form: [string, string][]): string => body(web.open(`${URL}?page=vpn`, { method: 'POST', form }));

test('Seguridad → VPN: keys, interface, peers and on/off; the private key never reaches the page', () => {
  const { lr, web } = lab();
  web.login(URL, 'admin', 'admin');
  assert.match(body(web.open(`${URL}?page=vpn`)), /Túnel wg0[\s\S]*Sin pares\./);
  post(web, [['action', 'vpn-iface'], ['genkey', '1'], ['address', '10.10.0.1/24'], ['listenPort', '51820']]);
  const st = vpnStatus(lr);
  assert.ok(st.publicKey);
  const peer = pubKey(genKey()) ?? '';
  post(web, [['action', 'vpn-peer-add'], ['publicKey', peer], ['allowedIps', '10.10.0.2/32, 192.168.2.0/24'], ['endpoint', '203.0.113.2:51820'], ['keepalive', '25']]);
  const page = post(web, [['action', 'vpn-service'], ['enabled', '1']]);
  assert.ok(lr.wgm.get('wg0')?.up, 'the tunnel is up');
  assert.ok(!page.includes(vpnStatus(lr).form.privateKey), 'the private key is not in the HTML');
  assert.ok(page.includes(st.publicKey ?? '-'));
  const file = hostSystem(lr).fs.readFile(VPN_CONF);
  assert.match(file, /^\[Interface\]\nAddress = 10\.10\.0\.1\/24\nListenPort = 51820\nPrivateKey = .{44}\n\n\[Peer\]\nPublicKey = .{44}\nAllowedIPs = 10\.10\.0\.2\/32, 192\.168\.2\.0\/24\nEndpoint = 203\.0\.113\.2:51820\nPersistentKeepalive = 25\n$/);
  assert.equal(hostSystem(lr).fs.stat(VPN_CONF).mode & 0o777, 0o600);
  assert.match(all(createShell(lr, 'linux', 'root').run('systemctl is-enabled wg-quick@wg0; ip route')), /enabled[\s\S]*192\.168\.2\.0\/24 dev wg0 scope link/);
  assert.match(post(web, [['action', 'vpn-peer-add'], ['publicKey', 'bad'], ['allowedIps', '10.0.0.0/8']]), /Valor no válido: peer 2: public key/);
  post(web, [['action', 'vpn-peer-del'], ['key', peer]]);
  assert.equal(lr.wgm.get('wg0')?.config.peers.length, 0, 'saving restarts the running tunnel');
  post(web, [['action', 'vpn-service']]);
  assert.equal(lr.wgm.get('wg0'), undefined);
});

const all = (l: string[]): string => l.join('\n');

test('saving from the GUI keeps PostUp hooks and rejects injected lines', () => {
  const { lr } = lab();
  hostSystem(lr).fs.writeFile(VPN_CONF, `[Interface]\nAddress = 10.9.0.1/24\nPrivateKey = ${genKey()}\nPostUp = nft add table inet x\n`);
  assert.equal(saveVpn(lr, { ...vpnStatus(lr).form, listenPort: '51999' }), null);
  assert.match(hostSystem(lr).fs.readFile(VPN_CONF), /ListenPort = 51999[\s\S]*PostUp = nft add table inet x/);
  const injected = vpnFileText({ privateKey: genKey(), address: '10.9.0.1/24\nPostUp = rm -rf /', listenPort: '', peers: [] }, null);
  assert.ok('error' in injected || !/rm -rf/.test(injected.text));
  assert.deepEqual(vpnFileText({ privateKey: 'x', address: '10.9.0.1/24', listenPort: '', peers: [] }, null), { error: 'PrivateKey' });
  assert.equal(setVpnActive(lr, true), null);
  assert.ok(lr.wgm.get('wg0')?.up);
});
