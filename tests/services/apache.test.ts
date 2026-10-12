/** Apache2 configured in /etc/apache2: virtual hosts, aliases, permissions, a2ensite/a2enmod, configtest and reload. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { parseIp } from '../../src/core/ip.ts';
import { words, moduleName } from '../../src/services/apache/conf.ts';

function lab(): { t: Topology; srv: Server; pc: Pc; root: ShellSession; client: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({ ...srv.services, dns: { enabled: true, origin: 'aula.lab', records: [
    { name: '@', type: 'A', value: '10.0.0.2', ttl: 60 }, { name: 'www', type: 'A', value: '10.0.0.2', ttl: 60 }, { name: 'empresa', type: 'A', value: '10.0.0.2', ttl: 60 },
  ] } });
  t.settle();
  return { t, srv, pc, root: createShell(srv, 'linux', 'root'), client: createShell(pc, 'linux') };
}

const SITE = `<VirtualHost *:80>
    ServerName empresa.aula.lab
    DocumentRoot /var/www/empresa
    Alias /docs /srv/docs
    Redirect /antigua http://www.aula.lab/
</VirtualHost>`;

test('config helpers: words with quotes and module names', () => {
  assert.deepEqual(words('LogFormat "%h %l" common'), ['LogFormat', '%h %l', 'common']);
  assert.equal(moduleName('mod_ssl.c'), 'ssl');
  assert.equal(moduleName('!rewrite_module'), 'rewrite');
});

test('the Ubuntu layout is in place and the default site serves /var/www/html', () => {
  const { root, client } = lab();
  assert.deepEqual(root.run('ls /etc/apache2 | tr "\\n" " "'), ['apache2.conf conf-available conf-enabled envvars mods-available mods-enabled ports.conf sites-available sites-enabled ']);
  assert.deepEqual(root.run('readlink /etc/apache2/sites-enabled/000-default.conf'), ['../sites-available/000-default.conf']);
  assert.match(client.run('curl -s http://www.aula.lab/').join('\n'), /Servidor web de Netfix/);
  assert.deepEqual(root.run('apache2ctl configtest'), [
    "AH00558: apache2: Could not reliably determine the server's fully qualified domain name, using 127.0.1.1. Set the 'ServerName' directive globally to suppress this message",
    'Syntax OK',
  ]);
});

test('a new name-based virtual host with Alias and Redirect, enabled with a2ensite and reload', () => {
  const { root, client } = lab();
  root.run('mkdir -p /var/www/empresa /srv/docs && echo "<h1>Empresa</h1>" > /var/www/empresa/index.html && echo "manual" > /srv/docs/manual.txt');
  root.run(`cat > /etc/apache2/sites-available/empresa.conf <<'EOF'\n${SITE}\nEOF`);
  assert.deepEqual(root.run('a2ensite empresa'), ['Enabling site empresa.', 'To activate the new configuration, you need to run:', '  systemctl reload apache2']);
  assert.deepEqual(root.run('a2ensite empresa'), ['Site empresa already enabled']);
  assert.match(client.run('curl -s http://empresa.aula.lab/').join(''), /Servidor web de Netfix/, 'not active until reload');
  assert.deepEqual(root.run('systemctl reload apache2'), []);
  assert.deepEqual(client.run('curl -s http://empresa.aula.lab/'), ['<h1>Empresa</h1>']);
  assert.match(client.run('curl -s http://www.aula.lab/').join(''), /Servidor web de Netfix/, 'other names keep the default site');
  assert.match(client.run('curl -s http://empresa.aula.lab/docs/manual.txt').join(''), /Forbidden/, '/srv is outside the allowed directories');
  root.run(`cat >> /etc/apache2/sites-available/empresa.conf <<'EOF'\n<Directory /srv/docs>\n    Options Indexes\n    Require all granted\n</Directory>\nEOF`);
  root.run('systemctl reload apache2');
  assert.deepEqual(client.run('curl -s http://empresa.aula.lab/docs/manual.txt'), ['manual']);
  assert.match(client.run('curl -s http://empresa.aula.lab/docs/').join('\n'), /<title>Index of \/docs\/<\/title>[\s\S]*manual\.txt/);
  assert.deepEqual(client.run('curl -sI http://empresa.aula.lab/antigua/x | grep --color=never -i -e "^HTTP" -e "^Location"'), ['HTTP/1.1 302 Found', 'Location: http://www.aula.lab/x']);
  assert.match(root.run('apache2ctl -S').join('\n'), /\*:80 +is a NameVirtualHost\n +default server 127\.0\.1\.1 \(\/etc\/apache2\/sites-enabled\/000-default\.conf:1\)\n +port 80 namevhost 127\.0\.1\.1[^\n]*\n +port 80 namevhost empresa\.aula\.lab \(\/etc\/apache2\/sites-enabled\/empresa\.conf:1\)/);
});

test('syntax errors: configtest, reload keeps the old configuration, restart fails', () => {
  const { srv, root, client } = lab();
  root.run('echo "DocumentRot /var/www/x" >> /etc/apache2/sites-available/000-default.conf');
  assert.deepEqual(root.run('apache2ctl configtest; echo $?'), [
    'AH00526: Syntax error on line 16 of /etc/apache2/sites-enabled/000-default.conf:',
    "Invalid command 'DocumentRot', perhaps misspelled or defined by a module not included in the server configuration",
    "Action 'configtest' failed.", 'The Apache error log may have more information.', '1',
  ]);
  assert.deepEqual(root.run('systemctl reload apache2; echo $?'), ['Job for apache2.service failed because the control process exited with error code.', 'See "systemctl status apache2.service" and "journalctl -xeu apache2.service" for details.', '1']);
  assert.match(client.run('curl -s http://www.aula.lab/').join(''), /Servidor web de Netfix/, 'still running with the old configuration');
  root.run('systemctl restart apache2');
  assert.equal(srv.services.http.enabled, false);
  assert.match(root.run('journalctl -u apache2 -n 12').join('\n'), /AH00526: Syntax error on line 16[\s\S]*Failed to start apache2\.service/);
  assert.deepEqual(client.run('curl -s http://www.aula.lab/; echo $?'), ['7']);
  assert.deepEqual(client.run('curl http://www.aula.lab/'), ["curl: (7) Failed to connect to www.aula.lab port 80 after 0 ms: Couldn't connect to server"]);
});

test('modules: a2enmod with dependencies, directives of disabled modules, ports.conf and Listen', () => {
  const { root, client } = lab();
  assert.deepEqual(root.run('a2enmod ssl'), [
    'Considering dependency setenvif for ssl:', 'Module setenvif already enabled', 'Considering dependency mime for ssl:', 'Module mime already enabled',
    'Considering dependency socache_shmcb for ssl:', 'Enabling module socache_shmcb.', 'Enabling module ssl.',
    'See /usr/share/doc/apache2/README.Debian.gz on how to configure SSL and create self-signed certificates.',
    'To activate the new configuration, you need to run:', '  systemctl restart apache2',
  ]);
  assert.match(root.run('apache2ctl -M').join('\n'), /ssl_module \(shared\)/);
  root.run('echo "RewriteEngine On" >> /etc/apache2/apache2.conf');
  assert.match(root.run('apache2ctl -t 2>&1').join('\n'), /Invalid command 'RewriteEngine'/);
  root.run('a2enmod rewrite >/dev/null; sed -i "s/^Listen 80$/Listen 80\\nListen 8081/" /etc/apache2/ports.conf; systemctl restart apache2');
  assert.match(client.run('curl -s http://10.0.0.2:8081/').join(''), /Servidor web de Netfix/);
  assert.match(root.run('ss -tln').join('\n'), /0\.0\.0\.0:8081/);
  assert.deepEqual(root.run('a2dismod nada'), ['ERROR: Module nada does not exist!']);
});

test('only root may change the configuration; the changes are saved with the topology', () => {
  const { t, srv, root } = lab();
  const admin = createShell(srv, 'linux');
  assert.match(admin.run('a2dissite 000-default').join('\n'), /ERROR: Could not remove \/etc\/apache2\/sites-enabled\/000-default\.conf: Permission denied/);
  root.run('a2dissite 000-default >/dev/null; mkdir /var/www/otra; echo hola > /var/www/otra/index.html');
  root.run(`printf '<VirtualHost *:80>\\nDocumentRoot /var/www/otra\\n</VirtualHost>\\n' > /etc/apache2/sites-available/otra.conf; a2ensite otra >/dev/null`);
  const t2 = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const srv2 = [...t2.placed.values()].find((p) => p.device.kind === 'server')?.device as Server;
  const pc2 = [...t2.placed.values()].find((p) => p.device.kind === 'pc')?.device as Pc;
  assert.deepEqual(createShell(srv2, 'linux', 'root').run("ls --color=never /etc/apache2/sites-enabled"), ['otra.conf']);
  assert.deepEqual(createShell(pc2, 'linux').run('curl -s http://10.0.0.2/'), ['hola']);
});
