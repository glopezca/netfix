/**
 * Names on GNU/Linux with systemd-resolved and WINS: two LANs joined by GW, which gives both Internet through NAT (so
 * apt reaches the Ubuntu archive) and the public DNS, which knows none of their names. SRV-WINS (LAN A) is the WINS
 * server (samba with «wins support = yes») and WIN-A is registered with it. LNX-A turns LLMNR on in resolved and sees
 * that ping only uses it through libnss-resolve; LNX-B points samba at the WINS and adds «wins» to nsswitch.conf;
 * WIN-B gets its WINS in the TCP/IP tab.
 */
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { Switch } from '../devices/switch.ts';
import type { HostOs } from '../devices/host.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { cloud } from './labs-vpn.ts';
import { rootScript } from './labs-linux.ts';
import { setSambaInstalled } from '../shells/samba-install.ts';
import { setWindowsWins } from './win-wins.ts';

const ip = (x: string): number => parseIp(x) ?? 0;
const RESOLVED_WINS_IP = '192.168.10.2';
const DNS = '8.8.8.8';

const GW_TWO_LANS = `
hostname GW
no ip domain-lookup
interface GigabitEthernet0/0
 description LAN A
 ip address 192.168.10.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 description LAN B
 ip address 192.168.20.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/2
 ip address dhcp
 ip nat outside
 no shutdown
access-list 1 permit 192.168.10.0 0.0.0.255
access-list 1 permit 192.168.20.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/2 overload`;

/** nmbd as the WINS server: one line in [global] of Ubuntu's smb.conf, and a restart. */
const WINS_SETUP = `sed -i 's/^   workgroup = WORKGROUP$/&\\n   wins support = yes/' /etc/samba/smb.conf
systemctl restart nmbd`;

interface HostSpec {
  readonly label: string;
  readonly os: HostOs;
  readonly x: number;
  readonly addr: string;
  readonly lan: 'a' | 'b';
  readonly port: number;
}

const HOSTS: readonly HostSpec[] = [
  { label: 'LNX-A', os: 'linux', x: 260, addr: '192.168.10.21', lan: 'a', port: 1 },
  { label: 'WIN-A', os: 'windows', x: 440, addr: '192.168.10.11', lan: 'a', port: 2 },
  { label: 'WIN-B', os: 'windows', x: 640, addr: '192.168.20.11', lan: 'b', port: 1 },
  { label: 'LNX-B', os: 'linux', x: 820, addr: '192.168.20.21', lan: 'b', port: 2 },
];

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

const gatewayOf = (lan: 'a' | 'b'): number => ip(lan === 'a' ? '192.168.10.1' : '192.168.20.1');

function hostOn(t: Topology, sw: Switch, spec: HostSpec): Pc {
  const pc = t.add('pc', spec.x, 600, { label: spec.label }).device as Pc;
  pc.os = spec.os;
  link(t, pc.id, 'FastEthernet0', sw.id, `FastEthernet0/${spec.port}`);
  pc.setStatic({ ip: ip(spec.addr), prefix: 24, gateway: gatewayOf(spec.lan), dns: ip(DNS) });
  return pc;
}

/** SRV-WINS: samba installed, nmbd serving WINS. */
function winsServer(t: Topology, sw: Switch): Server {
  const srv = t.add('server', 80, 600, { label: 'SRV-WINS' }).device as Server;
  link(t, srv.id, 'FastEthernet0', sw.id, 'FastEthernet0/24');
  srv.setStatic({ ip: ip(RESOLVED_WINS_IP), prefix: 24, gateway: gatewayOf('a'), dns: ip(DNS) });
  srv.setServices({ ...srv.services, dhcp: { ...srv.services.dhcp, enabled: false } });
  setSambaInstalled(srv, true);
  rootScript(srv, WINS_SETUP);
  return srv;
}

export const resolvedLab: Example = {
  id: 'nombres-resolved',
  title: LABS_ES['lab.nombres-resolved.title'],
  summary: LABS_ES['lab.nombres-resolved.summary'],
  build: () => {
    const t = new Topology();
    const isp = cloud(t, 'ISP-Norte', 760, 'Fibra0', 'public');
    const gw = t.add('router', 500, 240, { label: 'GW' }).device as Router;
    link(t, gw.id, 'GigabitEthernet0/2', isp.id, 'Fibra0');
    applyConfig(gw, GW_TWO_LANS.trim().split('\n'));
    const swA = t.add('switch', 260, 420, { label: 'SW-A' }).device as Switch;
    const swB = t.add('switch', 730, 420, { label: 'SW-B' }).device as Switch;
    link(t, gw.id, 'GigabitEthernet0/0', swA.id, 'GigabitEthernet0/1');
    link(t, gw.id, 'GigabitEthernet0/1', swB.id, 'GigabitEthernet0/1');
    for (const spec of HOSTS) hostOn(t, spec.lan === 'a' ? swA : swB, spec);
    t.settle();
    winsServer(t, swA);
    t.settle();
    setWindowsWins(t.byLabel('WIN-A') as Pc, ip(RESOLVED_WINS_IP));
    t.settle();
    return t;
  },
};
