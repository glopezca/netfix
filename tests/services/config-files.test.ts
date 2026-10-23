/**
 * «Configuración» of each service: the configuration files involved, read as they are now on disk (the same that
 * cat shows as root), in the order of the Services tab (SSH first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostFs } from '../../src/devices/host-fs.ts';
import { configSources, configFiles } from '../../src/services/config-files.ts';
import { hostSystem } from '../../src/shells/host-system.ts';

function server(kind: 'server' | 'linuxrouter'): Server {
  const t = new Topology();
  return t.add(kind, 0, 0).device as Server;
}

const paths = (srv: Server, id: string): string[] => configFiles(hostFs(srv)!, id).map((f) => f.path);

test('the services in the order of the Services tab: SSH first; the router adds its own', () => {
  assert.deepEqual(configSources(server('server')).map((s) => s.id), ['ssh', 'dhcp', 'dns', 'http', 'mail']);
  assert.deepEqual(configSources(server('linuxrouter')).map((s) => s.id), ['sysctl', 'firewall', 'vpn', 'ssh', 'dhcp', 'dns', 'http', 'mail']);
});

test('each service lists its files, expanding directories; the content is the current one', () => {
  const srv = server('server');
  assert.ok(paths(srv, 'ssh').includes('/etc/ssh/sshd_config'));
  assert.deepEqual(paths(srv, 'dhcp'), ['/etc/kea/kea-dhcp4.conf']);
  const dns = paths(srv, 'dns');
  assert.deepEqual(dns.slice(0, 3), ['/etc/bind/named.conf', '/etc/bind/named.conf.options', '/etc/bind/named.conf.local'], 'the main files first');
  assert.equal(new Set(dns).size, dns.length, 'each file once');
  assert.ok(paths(srv, 'http').includes('/etc/apache2/apache2.conf'));
  assert.deepEqual(paths(srv, 'mail'), ['/etc/postfix/main.cf', '/etc/dovecot/dovecot.conf']);
  const before = configFiles(hostFs(srv)!, 'dns').find((f) => f.path === '/etc/bind/named.conf.options')?.content ?? '';
  assert.match(before, /listen-on \{ any; \};/);
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, listenOn: ['lo'] } });
  assert.match(configFiles(hostFs(srv)!, 'dns').find((f) => f.path === '/etc/bind/named.conf.options')?.content ?? '', /listen-on \{ 127\.0\.0\.1; \};/);
  assert.equal(configFiles(hostFs(srv)!, 'dns').find((f) => f.path === '/etc/bind/named.conf.options')?.content,
    createShell(srv, 'linux', 'root').run('cat /etc/bind/named.conf.options').join('\n') + '\n');
});

test('router: sysctl.d, nftables.conf and WireGuard; a file written by hand also appears', () => {
  const lr = server('linuxrouter');
  assert.ok(paths(lr, 'sysctl').some((p) => p.startsWith('/etc/sysctl.d/')));
  assert.deepEqual(paths(lr, 'firewall'), ['/etc/nftables.conf']);
  hostSystem(lr).fs.writeFile('/etc/sysctl.d/10-aula.conf', 'net.ipv4.ip_forward = 1\n');
  assert.ok(paths(lr, 'sysctl').includes('/etc/sysctl.d/10-aula.conf'));
  assert.deepEqual(configFiles(hostFs(lr)!, 'nada'), []);
});

test('review: a link out of the service\'s tree is not followed (sites-enabled → sites-available still is)', () => {
  const srv = server('server');
  const fs = hostSystem(srv).fs;
  fs.symlink('/etc/shadow', '/etc/bind/robado');
  assert.ok(!paths(srv, 'dns').includes('/etc/bind/robado'));
  fs.writeFile('/etc/apache2/sites-available/aula.conf', '<VirtualHost *:80>\n</VirtualHost>\n');
  fs.symlink('/etc/apache2/sites-available/aula.conf', '/etc/apache2/sites-enabled/aula.conf');
  assert.ok(paths(srv, 'http').includes('/etc/apache2/sites-enabled/aula.conf'));
});
