/**
 * Security labs: SSH/SFTP with keys (and turning passwords off), and a hardened server segment with
 * defence in depth (IOS extended ACL on the router, nftables and sshd_config on the server).
 */
import { LABS_ES } from '../i18n/es-ES/labs.ts';
import type { Example } from './examples.ts';
import { Topology } from './topology.ts';
import type { Router } from '../devices/router.ts';
import type { Switch } from '../devices/switch.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import { applyConfig } from '../ios/session.ts';
import { parseIp } from '../core/ip.ts';
import { fileCmd, rootScript } from './labs-linux.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function link(t: Topology, a: string, ap: string, b: string, bp: string): void {
  t.connect({ device: a, port: ap }, { device: b, port: bp });
}

function pcAt(t: Topology, x: number, label: string, sw: Switch, port: string, addr: string, gw: string): Pc {
  const pc = t.add('pc', x, 580, { label }).device as Pc;
  link(t, pc.id, 'FastEthernet0', sw.id, port);
  pc.os = 'linux';
  pc.setStatic({ ip: ip(addr), prefix: 24, gateway: ip(gw), dns: ip('172.20.0.10') });
  return pc;
}

function sshServer(srv: Server, addr: string, gw: string, users: readonly { name: string; password: string }[]): void {
  srv.name = 'srv';
  srv.setStatic({ ip: ip(addr), prefix: 24, gateway: ip(gw), dns: ip('127.0.0.1') });
  srv.setServices({
    ...srv.services,
    dhcp: { ...srv.services.dhcp, enabled: false },
    ssh: { enabled: true, users },
    dns: { enabled: true, origin: 'aula.lab', records: [{ name: '@', type: 'NS', value: 'srv', ttl: 86400 }, { name: 'srv', type: 'A', value: addr, ttl: 86400 }] },
  });
}

// ------------------------------------------------------------ SSH and SFTP

export const sshLab: Example = {
  id: 'ssh-sftp',
  title: LABS_ES['lab.ssh-sftp.title'],
  summary: LABS_ES['lab.ssh-sftp.summary'],
  build: () => {
    const t = new Topology();
    const sw = t.add('switch', 460, 380).device as Switch;
    const srv = t.add('server', 760, 380, { label: 'SRV' }).device as Server;
    link(t, srv.id, 'FastEthernet0', sw.id, 'FastEthernet0/24');
    sshServer(srv, '172.20.0.10', '172.20.0.1', [{ name: 'admin', password: 'netfix' }, { name: 'ana', password: 'ana1' }]);
    pcAt(t, 220, 'PC0', sw, 'FastEthernet0/1', '172.20.0.21', '172.20.0.1');
    pcAt(t, 460, 'PC1', sw, 'FastEthernet0/2', '172.20.0.22', '172.20.0.1');
    t.settle();
    rootScript(srv, `${fileCmd('/home/ana/bienvenida.txt', 'Hola Ana: sube aquí tus entregas con SFTP.')}
chown ana:ana /home/ana/bienvenida.txt
mkdir -p /srv/compartido && chown admin:admin /srv/compartido && chmod 755 /srv/compartido`);
    return t;
  },
};

// ------------------------------------------------------------ hardening and defence in depth

const GW_ACL = `
hostname GW
no ip domain-lookup
enable secret Netfix2026
interface GigabitEthernet0/0
 description ADMINISTRACION
 ip address 192.168.10.1 255.255.255.0
 no shutdown
interface GigabitEthernet0/1
 description ALUMNOS
 ip address 192.168.20.1 255.255.255.0
 no shutdown
interface GigabitEthernet0/2
 description SERVIDORES
 ip address 172.20.0.1 255.255.255.0
 ip access-group A-SERVIDORES out
 no shutdown
ip access-list extended A-SERVIDORES
 remark la web es para todos; SSH y ping solo desde administracion
 permit tcp any host 172.20.0.10 eq www
 permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22
 permit icmp 192.168.10.0 0.0.0.255 any
 permit udp any host 172.20.0.10 eq domain
 deny ip any any log`;

const SERVER_RULES = `
flush ruleset

table inet filter {
  chain input {
    type filter hook input priority filter; policy drop;
    ct state established,related accept
    ct state invalid drop
    iifname "lo" accept
    tcp dport 80 accept comment "web para todos"
    udp dport 53 accept comment "DNS"
    ip saddr 192.168.10.0/24 tcp dport 22 accept comment "SSH solo administracion"
    ip saddr 192.168.10.0/24 icmp type echo-request accept
    log prefix "NFT-DROP " drop
  }
}`;

const SSHD_HARDENING = `
# Bastionado del laboratorio
PermitRootLogin no
MaxAuthTries 3
AllowUsers admin
PermitEmptyPasswords no`;

export const hardeningLab: Example = {
  id: 'bastionado',
  title: LABS_ES['lab.bastionado.title'],
  summary: LABS_ES['lab.bastionado.summary'],
  build: () => {
    const t = new Topology();
    const gw = t.add('router', 460, 140, { label: 'GW' }).device as Router;
    const swA = t.add('switch', 190, 380).device as Switch;
    const swB = t.add('switch', 730, 380).device as Switch;
    const srv = t.add('server', 460, 380, { label: 'SRV-INTRANET' }).device as Server;
    link(t, gw.id, 'GigabitEthernet0/0', swA.id, 'GigabitEthernet0/1');
    link(t, gw.id, 'GigabitEthernet0/1', swB.id, 'GigabitEthernet0/1');
    link(t, gw.id, 'GigabitEthernet0/2', srv.id, 'FastEthernet0');
    applyConfig(gw, GW_ACL.trim().split('\n'));
    sshServer(srv, '172.20.0.10', '172.20.0.1', [{ name: 'admin', password: 'netfix' }, { name: 'ana', password: 'ana1' }]);
    pcAt(t, 190, 'ADMIN', swA, 'FastEthernet0/1', '192.168.10.10', '192.168.10.1');
    pcAt(t, 730, 'ALUMNO', swB, 'FastEthernet0/1', '192.168.20.10', '192.168.20.1');
    t.settle();
    rootScript(srv, `${fileCmd('/etc/nftables.conf', SERVER_RULES)}
${fileCmd('/etc/ssh/sshd_config.d/10-bastionado.conf', SSHD_HARDENING)}
systemctl enable --now nftables
systemctl reload ssh`);
    t.settle();
    return t;
  },
};
