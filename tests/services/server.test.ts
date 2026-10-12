import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { sendMail, receiveMail } from '../../src/clients/mail-client.ts';
import type { MailAccount } from '../../src/clients/mail-client.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import type { ServerServices } from '../../src/services/config.ts';
import { pcCommand } from '../../src/devices/pc-console.ts';

const ip = (s: string): number => parseIp(s)!;

/** The prompt without its ANSI colours. */
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function services(base: ServerServices, extra: Partial<ServerServices> = {}): ServerServices {
  return {
    ...base,
    dhcp: { enabled: true, pools: [{ name: 'serverPool', start: ip('192.168.10.100'), prefix: 24, maxUsers: 50, gateway: ip('192.168.10.1'), dns: ip('192.168.10.2'), domain: 'aula.lab', leaseMinutes: 60, reservations: [] }] },
    dns: { enabled: true, records: [
      { name: 'srv.aula.lab', type: 'A', value: '192.168.10.2', ttl: 86400 },
      { name: 'www.aula.lab', type: 'CNAME', value: 'srv.aula.lab', ttl: 86400 },
      { name: 'aula.lab', type: 'MX', value: 'srv.aula.lab', priority: 10, ttl: 86400 },
      { name: 'aula.lab', type: 'NS', value: 'srv.aula.lab', ttl: 86400 },
    ] },
    mail: { smtp: true, pop3: true, imap: true, domain: 'aula.lab', users: [{ name: 'ana', password: 'ana1' }, { name: 'luis', password: 'luis1' }] },
    ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] },
    ...extra,
  };
}

/** Server-PT + switch + two PCs on 192.168.10.0/24. */
function lab(): { t: Topology; srv: Server; pcs: Pc[] } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pcs = [t.add('pc', 0, 0).device as Pc, t.add('pc', 0, 0).device as Pc];
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  pcs.forEach((pc, i) => t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: `FastEthernet0/${i + 1}` }));
  srv.setStatic({ ip: ip('192.168.10.2'), prefix: 24, gateway: ip('192.168.10.1'), dns: ip('192.168.10.2') });
  srv.setServices(services(srv.services));
  return { t, srv, pcs };
}

test('Server-PT DHCP: pool start/max users, options and reservation by MAC', () => {
  const { t, srv, pcs } = lab();
  const [a, b] = pcs as [Pc, Pc];
  const pool = srv.services.dhcp.pools[0]!;
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ ...pool, reservations: [{ ip: ip('192.168.10.50'), mac: b.mac }] }] } });
  pcs.forEach((p) => p.useDhcp());
  t.settle();
  assert.equal(formatIp(a.config.ip!), '192.168.10.100');
  assert.equal(formatIp(b.config.ip!), '192.168.10.50');
  assert.equal(formatIp(a.config.gateway!), '192.168.10.1');
  assert.equal(formatIp(a.config.dns!), '192.168.10.2');
  assert.equal(a.dhcpClient.lease?.leaseSeconds, 3600);
  assert.equal(a.dhcpClient.lease?.domainName, 'aula.lab');
  const log = createShell(srv, 'linux').run('journalctl -u kea-dhcp4-server').join('\n');
  assert.match(log, /DHCP4_LEASE_ALLOC .*lease 192\.168\.10\.100 has been allocated for 3600 seconds/);
  assert.match(createShell(srv, 'linux').run('cat /etc/kea/kea-dhcp4.conf').join('\n'), /"pool": "192\.168\.10\.100 - 192\.168\.10\.149"/);
});

test('DNS: dig, nslookup, host, PTR, NXDOMAIN, REFUSED and ping by name', () => {
  const { t, srv, pcs } = lab();
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const sh = createShell(pc, 'linux');
  const dig = sh.run('dig www.aula.lab').join('\n');
  assert.match(dig, /status: NOERROR/);
  assert.match(dig, /flags: qr aa rd; QUERY: 1, ANSWER: 2/);
  assert.match(dig, /www\.aula\.lab\.\s+86400\s+IN\tCNAME\tsrv\.aula\.lab\./);
  assert.match(dig, /srv\.aula\.lab\.\s+86400\s+IN\tA\t192\.168\.10\.2/);
  assert.deepEqual(sh.run('dig +short aula.lab MX'), ['10 srv.aula.lab.']);
  assert.match(sh.run('dig nada.aula.lab').join('\n'), /status: NXDOMAIN[\s\S]*AUTHORITY SECTION:[\s\S]*SOA/);
  assert.match(sh.run('dig google.com').join('\n'), /status: REFUSED/);
  assert.match(sh.run('dig -x 192.168.10.2').join('\n'), /PTR\tsrv\.aula\.lab\./);
  assert.match(sh.run('host www.aula.lab').join('\n'), /www\.aula\.lab is an alias for srv\.aula\.lab\.\nsrv\.aula\.lab has address 192\.168\.10\.2/);
  assert.match(sh.run('nslookup srv.aula.lab').join('\n'), /Name:\tsrv\.aula\.lab\nAddress: 192\.168\.10\.2/);
  assert.match(pcCommand(pc, 'nslookup www.aula.lab').join('\n'), /Name:    srv\.aula\.lab\nAddress:  192\.168\.10\.2\nAliases:  www\.aula\.lab/);
  assert.match(pcCommand(pc, 'ping www.aula.lab').join('\n'), /Pinging www\.aula\.lab \[192\.168\.10\.2\][\s\S]*Received = 4/);
  assert.match(sh.run('ping -c 2 www.aula.lab').join('\n'), /2 packets transmitted, 2 received, 0% packet loss/);
  assert.match(sh.run('ping noexiste.aula.lab').join('\n'), /Name or service not known/);
  assert.match(createShell(srv, 'linux').run('journalctl -u bind9 -n 1').join('\n'), /named\[845\]: client 192\.168\.10\.\d+#\d+ \(noexiste\.aula\.lab\): query: noexiste\.aula\.lab IN A .*NXDOMAIN/);
  assert.ok(t.net.history.some((e) => e.protocol === 'DNS'));
  srv.setUnit('dns', false);
  assert.match(sh.run('dig www.aula.lab').join('\n'), /communications error to 192\.168\.10\.2#53: timed out/);
});

test('HTTP: curl, wget, HEAD, 404, stopped service and Windows IIS banner', () => {
  const { t, srv, pcs } = lab();
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('curl http://www.aula.lab/').join('\n'), /<h1>Servidor web de netsim<\/h1>/);
  assert.match(sh.run('curl -I http://192.168.10.2/ayuda.html').join('\n'), /HTTP\/1\.1 200 OK\nServer: Apache\/2\.4\.62 \(Ubuntu\)/);
  assert.match(sh.run('curl http://www.aula.lab/nada.html').join('\n'), /Not Found/);
  assert.match(sh.run('wget http://www.aula.lab/ayuda.html').join('\n'), /‘ayuda\.html’ saved/);
  assert.match(sh.run('curl http://nohay.aula.lab').join('\n'), /curl: \(6\) Could not resolve host: nohay\.aula\.lab/);
  assert.match(sh.run('curl https://www.aula.lab').join('\n'), /curl: \(3\)/);
  assert.match(createShell(srv, 'linux').run('journalctl -u apache2').join('\n'), /"GET \/nada\.html HTTP\/1\.1" 404/);
  const ssrv = createShell(srv, 'linux');
  assert.match(ssrv.run('systemctl stop apache2').join('\n'), /Interactive authentication required/);
  assert.deepEqual(ssrv.run('sudo systemctl stop apache2'), []);
  assert.equal(ssrv.prompt(), '[sudo] password for admin: ');
  assert.equal(ssrv.secret(), true);
  assert.deepEqual(ssrv.run('cisco'), []);
  assert.deepEqual(ssrv.run('systemctl is-active apache2'), ['inactive']);
  assert.match(sh.run('curl http://www.aula.lab').join('\n'), /curl: \(7\) Failed to connect to www\.aula\.lab port 80 .*Couldn't connect to server/);
  ssrv.run('sudo systemctl start apache2');
  srv.os = 'windows';
  assert.match(pcCommand(pc, 'curl -I http://www.aula.lab').join('\n'), /Server: Microsoft-IIS\/10\.0/);
});

test('Mail: SMTP local delivery, POP3 removes, IMAP keeps, auth and unknown user', () => {
  const { t, srv, pcs } = lab();
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const ana: MailAccount = { name: 'Ana', address: 'ana@aula.lab', incoming: 'srv.aula.lab', outgoing: 'srv.aula.lab', protocol: 'IMAP', user: 'ana', password: 'ana1' };
  const luis: MailAccount = { ...ana, name: 'Luis', address: 'luis@aula.lab', user: 'luis', password: 'luis1', protocol: 'POP3' };
  assert.equal(sendMail(pc, ana, ['luis@aula.lab'], 'Hola', 'Prueba').ok, true);
  assert.equal(sendMail(pc, ana, ['ana@aula.lab'], 'Yo', 'Copia').ok, true);
  const bad = sendMail(pc, ana, ['pepe@aula.lab'], 'x', 'y');
  assert.equal(bad.ok, false);
  assert.match(bad.text, /550 .*User unknown/);
  const imap1 = receiveMail(pc, ana);
  const imap2 = receiveMail(pc, ana);
  assert.ok(imap1.ok && imap1.messages.length === 1 && imap2.ok && imap2.messages.length === 1, 'IMAP keeps mail on server');
  const pop1 = receiveMail(pc, luis);
  const pop2 = receiveMail(pc, luis);
  assert.ok(pop1.ok && pop1.messages[0]?.subject === 'Hola' && pop2.ok && pop2.messages.length === 0, 'POP3 removes mail');
  const wrong = receiveMail(pc, { ...luis, password: 'x' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.text, /-ERR \[AUTH\]/);
  assert.match(createShell(srv, 'linux').run('journalctl -u dovecot').join('\n'), /pop3-login: Disconnected \(auth failed/);
  srv.setUnit('smtp', false);
  assert.match((sendMail(pc, ana, ['luis@aula.lab'], 'x', 'y') as { text: string }).text, /rechazó la conexión SMTP/);
  assert.match(createShell(srv, 'linux').run('ss -tulpn').join('\n'), /tcp\s+LISTEN .*:110 .*dovecot/);
});

test('Mail relay between two domains through MX records', () => {
  const t = new Topology();
  const sw = t.add('switch', 0, 0).device as Switch;
  const a = t.add('server', 0, 0).device as Server;
  const b = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  [a, b, pc].forEach((d, i) => t.connect({ device: d.id, port: 'FastEthernet0' }, { device: sw.id, port: `FastEthernet0/${i + 1}` }));
  a.setStatic({ ip: ip('10.0.0.1'), prefix: 24, dns: ip('10.0.0.1') });
  b.setStatic({ ip: ip('10.0.0.2'), prefix: 24, dns: ip('10.0.0.1') });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, dns: ip('10.0.0.1') });
  a.setServices({ ...a.services, dns: { enabled: true, records: [
    { name: 'mail.uno.lab', type: 'A', value: '10.0.0.1', ttl: 60 }, { name: 'uno.lab', type: 'MX', value: 'mail.uno.lab', priority: 10, ttl: 60 },
    { name: 'mail.dos.lab', type: 'A', value: '10.0.0.2', ttl: 60 }, { name: 'dos.lab', type: 'MX', value: 'mail.dos.lab', priority: 10, ttl: 60 },
  ] }, mail: { smtp: true, pop3: true, imap: false, domain: 'uno.lab', users: [{ name: 'ana', password: '1' }] } });
  b.setServices({ ...b.services, mail: { smtp: true, pop3: true, imap: false, domain: 'dos.lab', users: [{ name: 'bea', password: '2' }] } });
  const acc: MailAccount = { name: 'Ana', address: 'ana@uno.lab', incoming: 'mail.uno.lab', outgoing: 'mail.uno.lab', protocol: 'POP3', user: 'ana', password: '1' };
  assert.equal(sendMail(pc, acc, ['bea@dos.lab'], 'Entre dominios', 'Hola Bea').ok, true);
  t.settle(5000);
  assert.equal(b.mailboxes.list('bea')[0]?.subject, 'Entre dominios');
  assert.match(createShell(a, 'linux').run('journalctl -u postfix').join('\n'), /to=<bea@dos\.lab>, status=sent \(relay=mail\.dos\.lab\[10\.0\.0\.2\]:25, 250/);
  assert.equal(sendMail(pc, acc, ['x@nodomain.lab'], 's', 'b').ok, true);
  t.settle(5000);
  assert.match(createShell(a, 'linux').run('journalctl -u postfix').join('\n'), /to=<x@nodomain\.lab>, status=bounced/);
});

test('SSH: login from Linux and Windows clients, remote commands, wrong password, exit', () => {
  const { t, srv, pcs } = lab();
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('ssh admin@srv.aula.lab'), []);
  assert.equal(sh.prompt(), "admin@srv.aula.lab's password: ");
  assert.equal(sh.secret(), true);
  assert.deepEqual(sh.run('mal'), ['Permission denied, please try again.']);
  assert.match(sh.run('cisco').join('\n'), /Welcome to Ubuntu 26\.04 LTS/);
  assert.equal(plain(sh.prompt()), `admin@${srv.name.toLowerCase()}:~$ `);
  assert.match(sh.run('systemctl status ssh').join('\n'), /● ssh\.service - OpenBSD Secure Shell server[\s\S]*Active: active \(running\)[\s\S]*Accepted password for admin/);
  assert.match(sh.run('hostname -I').join(''), /192\.168\.10\.2/);
  assert.match(sh.run('ping -c 1 192.168.10.1').join('\n'), /1 packets transmitted/, 'remote ping runs on the server');
  assert.deepEqual(sh.run('exit'), ['logout', 'Connection to srv.aula.lab closed.']);
  assert.match(plain(sh.prompt()), /^alumno@pc0:~\$ $/);
  const win = createShell(pc, 'windows');
  win.run('ssh admin@192.168.10.2');
  assert.match(win.run('cisco').join('\n'), /Welcome to Ubuntu/);
  win.run('exit');
  const bad = createShell(pc, 'linux');
  bad.run('ssh root@192.168.10.2');
  bad.run('a'); bad.run('b');
  assert.deepEqual(bad.run('c'), ['root@192.168.10.2: Permission denied (publickey,password).']);
  assert.match(createShell(srv, 'linux').run('journalctl -u ssh').join('\n'), /Failed password for invalid user root/);
  srv.setUnit('ssh', false);
  assert.deepEqual(createShell(pc, 'linux').run('ssh admin@192.168.10.2'), ['ssh: connect to host 192.168.10.2 port 22: Connection refused']);
  assert.deepEqual(createShell(pc, 'linux').run('ssh admin@nohay.lab'), ['ssh: Could not resolve hostname nohay.lab: Name or service not known']);
});

test('Windows Server-PT: sc, net start/stop, netstat; ssh session into Windows', () => {
  const { t, srv, pcs } = lab();
  srv.os = 'windows';
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const cmd = createShell(srv, 'windows');
  assert.match(cmd.run('sc query W3SVC').join('\n'), /STATE\s+: 4  RUNNING/);
  assert.match(cmd.run('net stop W3SVC').join('\n'), /service was stopped successfully/);
  assert.match(cmd.run('sc start W3SVC').join('\n'), /RUNNING/);
  assert.match(cmd.run('sc start W3SVC').join('\n'), /1056/);
  assert.match(cmd.run('net start').join('\n'), /Servidor DHCP[\s\S]*The command completed successfully/);
  assert.match(cmd.run('netstat -an').join('\n'), /TCP\s+192\.168\.10\.2:80\s+0\.0\.0\.0:0\s+LISTENING/);
  assert.match(cmd.run('sc query nada').join('\n'), /FAILED 1060/);
  assert.match(cmd.run('foo').join('\n'), /is not recognized/);
  const sh = createShell(pc, 'linux');
  sh.run('ssh admin@192.168.10.2');
  assert.match(sh.run('cisco').join('\n'), /Microsoft Windows/);
  assert.equal(sh.prompt(), `admin@${srv.name.toUpperCase()} C:\\Users\\admin>`);
  assert.match(sh.run('hostname').join(''), new RegExp(srv.name));
  sh.run('exit');
});

test('Linux shell basics on a PC and service commands where no service exists', () => {
  const { t, pcs } = lab();
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const sh = createShell(pc, 'linux');
  sh.run('ping -c 1 192.168.10.2');
  assert.match(sh.run('ip a').join('\n'), /inet 192\.168\.10\.100\/24 brd 192\.168\.10\.255 scope global dynamic eth0/);
  assert.deepEqual(sh.run('ip r'), ['default via 192.168.10.1 dev eth0 proto dhcp metric 100', '192.168.10.0/24 dev eth0 proto kernel scope link src 192.168.10.100']);
  assert.match(sh.run('ip neigh').join('\n'), /192\.168\.10\.2 dev eth0 lladdr .* REACHABLE/);
  assert.match(sh.run('ifconfig').join('\n'), /sudo apt install net-tools/);
  assert.match(sh.run('cat /etc/resolv.conf').join('\n'), /nameserver 192\.168\.10\.2/);
  assert.match(sh.run('cat /etc/netplan/50-cloud-init.yaml').join('\n'), /dhcp4: true/);
  assert.deepEqual(sh.run('cat /no'), ['cat: /no: No such file or directory']);
  assert.match(sh.run('systemctl status apache2').join(''), /could not be found/);
  assert.deepEqual(sh.run('journalctl -u apache2'), ['-- No entries --']);
  assert.deepEqual(sh.run('nada'), ['nada: command not found']);
  assert.ok(sh.run('help').length > 5);
  assert.deepEqual(sh.run('whoami'), ['alumno']);
  assert.match(sh.run('dhclient').join(''), /Permission denied/);
  assert.deepEqual(sh.run('sudo dhclient -r eth0'), []);
  assert.equal(pc.config.ip, undefined);
  assert.deepEqual(sh.run('sudo dhclient eth0'), []);
  assert.equal(formatIp(pc.config.ip!), '192.168.10.100');
});

test('relay: router ip helper-address towards a Server-PT DHCP pool', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const r = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/1' });
  applyConfig(r, ['interface GigabitEthernet0/0', ' ip address 10.0.0.1 255.255.255.0', 'interface GigabitEthernet0/1', ' ip address 172.16.0.1 255.255.255.0', ' ip helper-address 10.0.0.2']);
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24, gateway: ip('10.0.0.1') });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'remota', start: ip('172.16.0.10'), prefix: 24, maxUsers: 20, gateway: ip('172.16.0.1'), leaseMinutes: 1440, reservations: [] }] } });
  pc.useDhcp();
  t.settle();
  assert.equal(formatIp(pc.config.ip!), '172.16.0.10');
  assert.equal(formatIp(pc.config.gateway!), '172.16.0.1');
});

test('topology JSON v2 round-trips a Server-PT with services and mailboxes', () => {
  const { t, srv, pcs } = lab();
  pcs[0]!.useDhcp();
  t.settle();
  srv.mailboxes.deliver('ana', { from: 'x@y.z', to: ['ana@aula.lab'], subject: 'Guardado', body: '...', date: 1 });
  srv.autostart = { ...srv.autostart, ssh: false };
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  assert.equal(json.version, 2);
  assert.equal(json.devices.find((d: { kind: string }) => d.kind === 'server').server.services.dhcp.pools[0].start, '192.168.10.100');
  const t2 = Topology.fromJSON(json);
  const s2 = [...t2.placed.values()].map((p) => p.device).find((d): d is Server => d instanceof Server)!;
  assert.deepEqual(JSON.parse(JSON.stringify(s2.services)), JSON.parse(JSON.stringify(srv.services)));
  assert.equal(s2.mailboxes.list('ana')[0]?.subject, 'Guardado');
  assert.equal(s2.autostart.ssh, false);
  assert.equal(s2.os, 'linux');
  const p2 = t2.byLabel('PC0') as Pc;
  assert.equal(formatIp(p2.config.ip!), '192.168.10.100');
  const broken = JSON.parse(JSON.stringify(json));
  broken.devices.find((d: { kind: string }) => d.kind === 'server').server.services.dhcp.pools[0].start = 'no-ip';
  assert.throws(() => Topology.fromJSON(broken), /IP no válida/);
});

test('review regressions: malformed URL, relay loop guard, SSH session bound to client, ssh -l, wide pool', () => {
  const { t, srv, pcs } = lab();
  const [a, b] = pcs as [Pc, Pc];
  a.useDhcp();
  b.useDhcp();
  t.settle();
  const sh = createShell(a, 'linux');
  assert.match(sh.run('curl http://192.168.10.2/%').join('\n'), /Not Found/, 'malformed escape does not crash the server');
  // Relay loop: the server's MX for other.lab points back to itself.
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, records: [...srv.services.dns.records, { name: 'other.lab', type: 'MX', value: 'srv.aula.lab', priority: 5, ttl: 60 }] } });
  const acc: MailAccount = { name: 'Ana', address: 'ana@aula.lab', incoming: 'srv.aula.lab', outgoing: 'srv.aula.lab', protocol: 'POP3', user: 'ana', password: 'ana1' };
  assert.equal(sendMail(a, acc, ['x@other.lab'], 'loop', 'b').ok, true);
  t.settle(10_000);
  assert.match(createShell(srv, 'linux').run('journalctl -u postfix').join('\n'), /status=bounced \(mail for other\.lab loops back to myself\)/);
  // SSH session ids are bound to the client address.
  sh.run('ssh -l admin srv.aula.lab');
  assert.equal(sh.prompt(), "admin@srv.aula.lab's password: ");
  sh.run('cisco');
  const session = srv.ssh.activeSessions()[0]!.id;
  const thief = createShell(b, 'linux');
  const r = (thief as unknown as { host: Pc }).host;
  let reply: unknown;
  r.connect(ip('192.168.10.2'), 22, { app: 'SSH', kind: 'command', session, line: 'whoami' }, (x) => { reply = x; });
  t.settle(2000);
  assert.match(JSON.stringify(reply), /Connection closed by remote host/);
  assert.deepEqual(sh.run('whoami'), ['admin']);
  sh.run('exit');
  // A /8 pool with a late start address allocates without scanning the whole subnet.
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'big', start: ip('10.200.0.1'), prefix: 8, maxUsers: 5, leaseMinutes: 60, reservations: [] }] } });
  const startMs = Date.now();
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 8 });
  a.useDhcp();
  t.settle();
  assert.equal(formatIp(a.config.ip!), '10.200.0.1');
  assert.ok(Date.now() - startMs < 2000, 'allocation is fast');
});
