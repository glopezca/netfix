/**
 * File sharing with Samba on a GNU/Linux server: SRV installs samba with apt and shares two folders, «publico» (guests
 * read and write, as nobody) and «profes» (only the teachers' Samba accounts; ana has one, luis not yet). PC0 (Windows)
 * reaches them with net view / net use, PC1 (GNU/Linux) with smbclient once it installs it. GW gives the classroom
 * Internet through NAT, so apt reaches the Ubuntu archive.
 */
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import type { Switch } from '../devices/switch.ts';
import type { HostOs } from '../devices/host.ts';
import type { Router } from '../devices/router.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { rootScript } from './labs-linux.ts';
import { cloud } from './labs-vpn.ts';

const ip = (x: string): number => parseIp(x) ?? 0;
const GATEWAY = '172.20.0.1';
const SRV_IP = '172.20.0.10';
/** The public DNS: the classroom has no DNS server, so its names are found with NetBIOS (nmbd on SRV). */
const DNS = '8.8.8.8';

const GW_NAT = `
hostname GW
no ip domain-lookup
interface GigabitEthernet0/0
 description AULA
 ip address 172.20.0.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 ip address dhcp
 ip nat outside
 no shutdown
access-list 1 permit 172.20.0.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload`;

const SHARES = `
[publico]
   comment = Carpeta pública
   path = /srv/samba/publico
   read only = no
   guest ok = yes

[profes]
   comment = Solo profesorado
   path = /srv/samba/profes
   read only = no
   valid users = ana luis
`;

/** apt install samba, the folders with their Linux permissions (profes: ana and the group users, which luis is in), the shares, and ana's Samba account. */
const SETUP = `apt install -y samba
mkdir -p /srv/samba/publico /srv/samba/profes
chmod 777 /srv/samba/publico
chown ana:users /srv/samba/profes && chmod 770 /srv/samba/profes
cat >> /etc/samba/smb.conf <<'NETFIX_EOF'
${SHARES.trimEnd()}
NETFIX_EOF
printf 'ana1\\nana1\\n' | smbpasswd -s -a ana
systemctl restart smbd`;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

function pcAt(t: Topology, x: number, label: string, sw: Switch, port: string, addr: string, os: HostOs): Pc {
  const pc = t.add('pc', x, 580, { label }).device as Pc;
  link(t, pc.id, 'FastEthernet0', sw.id, port);
  pc.os = os;
  pc.setStatic({ ip: ip(addr), prefix: 24, gateway: ip(GATEWAY), dns: ip(DNS) });
  return pc;
}

export const sambaLab: Example = {
  id: 'samba',
  title: LABS_ES['lab.samba.title'],
  summary: LABS_ES['lab.samba.summary'],
  build: () => {
    const t = new Topology();
    const isp = cloud(t, 'ISP-Norte', 640, 'Fibra0', 'public');
    const gw = t.add('router', 460, 240, { label: 'GW' }).device as Router;
    link(t, gw.id, 'GigabitEthernet0/1', isp.id, 'Fibra0');
    applyConfig(gw, GW_NAT.trim().split('\n'));
    const sw = t.add('switch', 460, 400, { label: 'Switch0' }).device as Switch;
    link(t, gw.id, 'GigabitEthernet0/0', sw.id, 'GigabitEthernet0/1');
    const srv = t.add('server', 760, 400, { label: 'SRV' }).device as Server;
    link(t, srv.id, 'FastEthernet0', sw.id, 'FastEthernet0/24');
    srv.setStatic({ ip: ip(SRV_IP), prefix: 24, gateway: ip(GATEWAY), dns: ip(DNS) });
    srv.setServices({
      ...srv.services,
      dhcp: { ...srv.services.dhcp, enabled: false },
      ssh: { enabled: true, users: [{ name: 'ana', password: 'ana1' }, { name: 'luis', password: 'luis1' }] },
    });
    pcAt(t, 220, 'PC0', sw, 'FastEthernet0/1', '172.20.0.21', 'windows');
    pcAt(t, 460, 'PC1', sw, 'FastEthernet0/2', '172.20.0.22', 'linux');
    t.settle();
    rootScript(srv, SETUP);
    return t;
  },
};
