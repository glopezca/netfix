/** Documentation: the Server's HTTP service (Apache2 or IIS), in guided style. */
import type { DocPage } from '../types.ts';
import { check, code, exercise, figure, h, list, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/glopezca/netfix/blob/main/';

export const HTTP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-http',
    title: 'Web server',
    summary: 'Publishing HTML pages from the panel or from /var/www/html and testing them with the browser and curl.',
    markdownBase: MD,
    blocks: [
      p('A web server hands out pages when a browser asks for them over HTTP (port 80). On a Server with Ubuntu the service is **Apache2**; with Windows Server, **IIS**. On both, **Services → HTTP** lists the site’s files (index.html, ayuda.html…) and lets you create, edit and delete them.'),
      figure({
        type: 'sequence',
        actors: ['PC0 (browser)', 'SRV (bind9)', 'SRV (apache2)'],
        messages: [
          { from: 0, to: 1, text: 'www.aula.lab A?', note: 'DNS (53/udp)' },
          { from: 1, to: 0, text: '192.168.10.2' },
          { from: 0, to: 2, text: 'GET / HTTP/1.1', note: 'Host: www.aula.lab (80/tcp)' },
          { from: 2, to: 0, text: '200 OK', note: 'index.html' },
        ],
      }, 'To open http://www.aula.lab the PC first resolves the name and then asks port 80 for the page.'),
      h('Publishing a page'),
      steps(
        ['Switch the service on', '**Services → HTTP**: the **HTTP service (Apache2, ports 80)** switch.'],
        ['Create the file', 'In **New file** type a name such as `hola.html` (or `docs/guia.html`, no spaces) and click **Create**.'],
        ['Write the contents', 'Select it in the list, write the HTML in **Edit hola.html** and click **Save**.'],
        ['Test it', 'From a PC: **Web Browser** with http://www.aula.lab/hola.html, or `curl` in the terminal.'],
      ),
      p('A path that does not exist returns **404 Not Found**. The Server header says Apache/2.4.62 (Ubuntu) or Microsoft-IIS/10.0 depending on the server’s system. HTTPS is not simulated.'),
      check('Check it with curl', '`curl -I` shows only the response headers: the code (200, 404…), the server and the content type.'),
      term('shell', 'alumno@pc1:~$ curl -I http://www.aula.lab\nHTTP/1.1 200 OK\nDate: Sat, 24 Oct 2026 06:24:07 GMT\nServer: Apache/2.4.62 (Ubuntu)\nContent-Length: 400\nContent-Type: text/html; charset=UTF-8\nalumno@pc1:~$ curl -s -o /dev/null -w "%{http_code}\\n" http://www.aula.lab/noexiste\n404'),
      h('From the server’s Linux Terminal'),
      p('/var/www/html is the same folder the panel lists: what is written there appears in the panel and is served at once. It belongs to root, so sudo is needed.'),
      code('admin@srv:~$ sudo nano /var/www/html/index.html\nadmin@srv:~$ echo "<h1>Hola</h1>" | sudo tee /var/www/html/hola.html\nadmin@srv:~$ ls -l /var/www/html'),
      tip('Web applications', 'In the same panel, **Web applications** turns on **Server web management** and **Roundcube (webmail)**, each on an Apache alias (/admin, /roundcube) or on a port of its own. They have their own page in this documentation.'),
      warn('Common mistakes', '“This site can’t be reached” in the browser: the service is stopped, the name does not resolve (try the IP address) or there is no route to the server. **403 Forbidden**: Apache cannot read the folder (see Apache2). Editing /var/www/html without sudo: “Permission denied”.'),
      exercise('Your first page', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, publish hola.html with a `<h1>Hola</h1>` heading and open it from PC0.', 'Services → HTTP → New file `hola.html` → Create; write `<h1>Hola</h1>` and **Save**. On PC0 → Web Browser: http://www.aula.lab/hola.html shows “Hola”. In PC1’s Linux Terminal, `curl http://www.aula.lab/hola.html` returns the same HTML.'),
    ],
  },
  {
    id: 'srv-apache',
    title: 'Apache2 in /etc/apache2',
    summary: 'Ubuntu’s real configuration step by step: sites, modules, ports, VirtualHost, checking and reloading.',
    markdownBase: MD,
    blocks: [
      p('On a Server with Ubuntu, Apache 2.4 is configured as on Ubuntu, with the files in **/etc/apache2** (as root or with sudo). The HTTP panel still edits /var/www/html, the default site’s folder (000-default.conf). On Windows Server the service is IIS and it serves that same list of files.'),
      table(['File or folder', 'What it is for'], [
        ['apache2.conf', 'Main configuration: includes the rest and defines the allowed <Directory> (/var/www and /usr/share).'],
        ['ports.conf', 'Ports with Listen (80; 443 if ssl is enabled).'],
        ['sites-available/ · sites-enabled/', 'Sites (VirtualHost). Enabled with a2ensite and disabled with a2dissite.'],
        ['mods-available/ · mods-enabled/', 'Modules (a2enmod / a2dismod): alias, dir, autoindex, rewrite, ssl, headers, userdir…'],
        ['conf-available/ · conf-enabled/', 'Configuration snippets (a2enconf / a2disconf): security.conf, charset.conf…'],
      ]),
      h('Step by step: a second site with VirtualHost'),
      p('With **name-based VirtualHost**, a single server with one IP address serves several sites: Apache picks the site by the Host header the browser sends (ServerName or ServerAlias). If none matches, the first one on that port answers.'),
      steps(
        ['Create the site’s folder', '`sudo mkdir -p /var/www/empresa` and its `index.html`.'],
        ['Write the site', 'A new file in sites-available with the `<VirtualHost *:80>` block, its **ServerName** and its **DocumentRoot**.'],
        ['Enable it', '`sudo a2ensite empresa` creates the link in sites-enabled.'],
        ['Check the syntax', '`sudo apache2ctl configtest` must end in **Syntax OK**. If not, it gives the file and line of the error.'],
        ['Reload Apache', '`sudo systemctl reload apache2`. Without a reload, the changes are not applied.'],
        ['Register the name', 'In **Services → DNS**, an `empresa` CNAME `srv` record in aula.lab, so the PCs find empresa.aula.lab.'],
      ),
      term('apache', '<VirtualHost *:80>\n    ServerName empresa.aula.lab\n    DocumentRoot /var/www/empresa\n    Alias /docs /srv/docs\n    Redirect /antigua http://www.aula.lab/\n</VirtualHost>'),
      term('shell', 'admin@srv:~$ sudo a2ensite empresa\n[sudo] password for admin:\nEnabling site empresa.\nTo activate the new configuration, you need to run:\n  systemctl reload apache2\nadmin@srv:~$ sudo apache2ctl configtest\nAH00558: apache2: Could not reliably determine the server\'s fully qualified domain name, using 127.0.1.1. Set the \'ServerName\' directive globally to suppress this message\nSyntax OK\nadmin@srv:~$ sudo systemctl reload apache2'),
      tip('The AH00558 notice', 'It is not an error: Apache warns that there is no global ServerName. It goes away with `ServerName srv.aula.lab` in apache2.conf. What matters is the last line, **Syntax OK**.'),
      check('Check it from a PC', 'Each name leads to its site even though both point to the same IP address. With `curl -H "Host: …"` you can test a site before its name is in DNS.'),
      term('shell', 'alumno@pc1:~$ curl http://empresa.aula.lab/\n<h1>Empresa</h1>\nalumno@pc1:~$ curl -H "Host: empresa.aula.lab" http://192.168.10.2/\n<h1>Empresa</h1>'),
      h('Worth knowing'),
      list(
        'Changes are not applied until systemctl reload (sites, conf) or restart (modules, ports). If the configuration has errors, reload fails and Apache keeps the previous one; restart leaves it stopped.',
        'Permissions: Apache reads as www-data. A DocumentRoot outside /var/www or /usr/share gives 403 Forbidden until you add <Directory …> Require all granted </Directory>. Without index.html, Options Indexes shows the directory listing (“Index of /”).',
        'Supported directives: Listen, VirtualHost, ServerName, ServerAlias, DocumentRoot, Alias, Redirect, DirectoryIndex, ErrorDocument, Options, Require, Include/IncludeOptional, IfModule, IfDefine… Those of a disabled module give “Invalid command”.',
        'Changes in /etc/apache2 (deleted files too, such as a disabled site) are saved with the topology.',
      ),
      warn('Common mistakes', 'A misspelt directive: configtest gives “AH00526: Syntax error on line 3 of …: Invalid command \'DocumentRot\'…”. Forgetting the reload. Testing the site by its name without having registered it in DNS: the browser does not find it.'),
      exercise('Fix the site', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, create the empresa.aula.lab site from the steps, but type `DocumentRot`. Find the error, fix it and check the site from PC1.', '`sudo apache2ctl configtest` answers “AH00526: Syntax error on line 3 of /etc/apache2/sites-enabled/empresa.conf: Invalid command \'DocumentRot\'…”. Fix the line (for example with `sudo nano /etc/apache2/sites-available/empresa.conf`), run configtest again (Syntax OK) and `sudo systemctl reload apache2`. With the CNAME `empresa` → `srv`, `curl http://empresa.aula.lab/` on PC1 returns `<h1>Empresa</h1>`; www.aula.lab still shows the default site.'),
    ],
  },
];
