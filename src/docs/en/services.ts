/** Documentation: Server services (DHCP, DNS, HTTP, mail, SSH) and their equivalents on Ubuntu and Windows. */
import type { DocGroup } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const SERVICE_DOCS: DocGroup = {
  id: 'servicios',
  title: 'Server services',
  pages: [
    {
      id: 'srv-intro',
      title: 'Server',
      summary: 'Server tabs, operating system and service names.',
      blocks: [
        p('A Server is a device that provides network services. Each service has its own switch and panel in the Services tab; changes take effect immediately and are reflected in the configuration files seen by the Linux Terminal.'),
        table(['Service', 'Port', 'systemd unit (Ubuntu)', 'Windows service', 'Configuration on Linux'], [
          ['DHCP', '67/udp', 'kea-dhcp4-server', 'DHCPServer', '/etc/kea/kea-dhcp4.conf, /var/lib/kea/kea-leases4.csv'],
          ['DNS', '53/udp', 'bind9 (named)', 'DNS', '/etc/bind/named.conf.local, /etc/bind/db.<zone>'],
          ['HTTP', '80/tcp', 'apache2', 'W3SVC', '/var/www/html (editable)'],
          ['SMTP', '25/tcp', 'postfix', 'SMTPSVC', '/etc/postfix/main.cf'],
          ['POP3 / IMAP', '110 / 143', 'dovecot', 'POP3Svc', '/etc/dovecot/dovecot.conf'],
          ['SSH', '22/tcp', 'ssh', 'sshd', '/etc/ssh/sshd_config'],
        ]),
        h('Managing services from the terminal'),
        code('admin@srv:~$ systemctl status apache2\nadmin@srv:~$ sudo systemctl stop apache2\nadmin@srv:~$ sudo systemctl enable --now bind9\nadmin@srv:~$ journalctl -u kea-dhcp4-server -n 20\nadmin@srv:~$ ss -tulpn\n\nC:\\home\\admin> sc query W3SVC\nC:\\home\\admin> net stop DNS'),
        note('Without sudo, systemctl start/stop/restart/enable/disable replies “Interactive authentication required”, just as on Ubuntu.'),
      ],
    },
    {
      id: 'srv-dhcp',
      title: 'Server DHCP',
      summary: 'Packet Tracer–style pools, reservations and automatic assignment by MAC or Client-ID.',
      blocks: [
        p('Each pool is defined as in Packet Tracer: start IP + maximum number of users within a subnet, with default gateway, DNS server, domain, TFTP server and lease time in minutes (or infinite).'),
        h('Reservations'),
        p('Select a pool and add reservations: a fixed IP for a client identified by its MAC address or its Client-ID (option 61), with an optional name. The IP must be in the pool’s subnet; duplicate IPs or identifiers are not allowed.'),
        table(['Field', 'Format'], [
          ['MAC', '0001.42AB.CDEF or 00:01:42:ab:cd:ef'],
          ['Client-ID', 'Hexadecimal with or without dots (0100.0142.abcd.ef); the usual Windows one is 01 + MAC'],
        ]),
        h('Automatic assignments'),
        p('“Identify automatic leases by” decides what identifies a client that has no reservation:'),
        list(
          'Client-ID (option 61) or, if it is not sent, MAC: the normal DHCP behaviour (RFC 2131) and kea’s default.',
          'MAC: ignores the Client-ID; the same device keeps its IP even if it changes operating system or Client-ID (kea: "match-client-id": false).',
        ),
        p('In the leases table, the “Reserve by MAC” and “Reserve by Client-ID” buttons turn an automatic lease into a reservation.'),
        code('"reservations": [\n  { "hw-address": "00:50:f0:00:00:02", "ip-address": "192.168.10.50" },\n  { "client-id": "01:00:50:f0:00:00:03", "ip-address": "192.168.10.51" }\n],\n"match-client-id": false'),
      ],
    },
    {
      id: 'srv-dns',
      title: 'Server DNS',
      summary: 'Records, relative and absolute names, zone domain ($ORIGIN) and responses.',
      blocks: [
        p('The server is authoritative for the zones of its records. It answers NOERROR with the data, NXDOMAIN (with the SOA in AUTHORITY) if the name does not exist in its zone, and REFUSED if the query belongs to another zone. PTR records for A records are generated automatically.'),
        table(['Type', 'Value', 'Example'], [
          ['A', 'IPv4 address', 'srv → 192.168.10.2'],
          ['CNAME', 'Canonical name', 'www → srv'],
          ['MX', 'Mail server + priority', 'aula.lab. → 10 srv'],
          ['NS', 'Name server', '@ → srv'],
          ['TXT', 'Text', '@ → "v=spf1 mx -all"'],
        ]),
        h('Relative and absolute names'),
        p('With a zone domain ($ORIGIN), for example aula.lab, names are written as in a BIND zone file:'),
        table(['You type', 'It means', 'Why'], [
          ['www', 'www.aula.lab.', 'Relative: the domain is appended.'],
          ['@', 'aula.lab.', 'The domain itself.'],
          ['srv.aula.lab.', 'srv.aula.lab.', 'Absolute: it ends with a dot and is left as is.'],
          ['ftp.otra.lab.', 'ftp.otra.lab.', 'Absolute in another zone: the server serves that one too.'],
          ['srv.aula.lab', 'srv.aula.lab.aula.lab.', 'Classic mistake: without the trailing dot it is relative.'],
          ['*', '*.aula.lab.', 'Wildcard: answers for any name in the zone that does not exist.'],
          ['*.dev', '*.dev.aula.lab.', 'Subdomain wildcard: app.dev.aula.lab, api.dev.aula.lab…'],
        ]),
        p('The same applies to CNAME, MX and NS values: “www CNAME @” or “@ MX 10 @” point to the domain itself. The form shows the resulting fully qualified name (FQDN) before saving. Without a zone domain, all names are treated as absolute.'),
        h('Wildcard records'),
        list(
          'The wildcard is only used if the queried name does not exist: a name with its own records (or with records below it, such as b.c.aula.lab if a.b.c.aula.lab exists) answers NOERROR with no data for the types it lacks.',
          'It is looked up at the “closest encloser” (RFC 4592): with *.aula.lab and srv.aula.lab, the query x.srv.aula.lab returns NXDOMAIN, because srv.aula.lab exists and has no *.srv.aula.lab.',
          'The answer carries the queried name as its owner; a CNAME wildcard is followed like any CNAME.',
          '“*” can only be the first label of a name and never a value; wildcards do not generate PTR records.',
        ),
        code('*      IN  A      192.168.10.80   ; anything.aula.lab → .80\n*.dev  IN  CNAME  srv             ; app.dev.aula.lab → srv.aula.lab\n@      IN  MX     10 @'),
        code('$ORIGIN aula.lab.\n$TTL 86400\n@\tIN\tSOA\tsrv.aula.lab. hostmaster.aula.lab. ( … )\n@\tIN\tNS\tsrv\n@\tIN\tMX\t10 srv\nsrv\tIN\tA\t192.168.10.2\nwww\tIN\tCNAME\tsrv'),
        note('Check it from a PC: dig www.aula.lab, dig +short aula.lab MX, dig -x 192.168.10.2, nslookup or host.'),
        note('Search domain: when the DHCP pool has a domain-name (option 15), the PC adds it to /etc/resolv.conf (“search aula.lab”) and to Windows’ “Connection-specific DNS Suffix”. So ping, nslookup, host, curl, ssh and the browser complete a name without dots (www → www.aula.lab), as glibc with ndots:1: first with the domain, then as typed; a name with dots goes as typed first; a final dot (“www.”) skips the search. dig does not use the search list unless +search, as the real dig. hostname -f gives the canonical name from /etc/hosts (on Ubuntu it does not include the DHCP domain).'),
      ],
    },
    {
      id: 'srv-http',
      title: 'Web server',
      summary: 'HTML files, /var/www/html and the Apache and IIS banners.',
      blocks: [
        p('The HTTP panel lists the site’s files (index.html, ayuda.html…) and lets you create, edit and delete them. A path that does not exist returns 404 Not Found. The banner is Apache/2.4.62 (Ubuntu) or Microsoft-IIS/10.0 depending on the server’s operating system.'),
        h('From the server’s Linux Terminal'),
        p('/var/www/html is the same folder: whatever is written there appears in the panel and is served immediately. It belongs to root, so you need sudo.'),
        code('admin@srv:~$ sudo nano /var/www/html/index.html\nadmin@srv:~$ echo "<h1>Hola</h1>" | sudo tee /var/www/html/hola.html\nadmin@srv:~$ ls -l /var/www/html'),
        p('From a PC: the Web Browser, curl -I http://www.aula.lab or wget http://www.aula.lab/hola.html. HTTPS is not simulated.'),
      ],
    },
    {
      id: 'srv-apache',
      title: 'Apache2 in /etc/apache2',
      summary: 'Real Ubuntu configuration: sites, modules, ports, VirtualHost, Alias, permissions and reloading.',
      blocks: [
        p('On a Server running Ubuntu, the HTTP service is Apache 2.4 and is configured as on Ubuntu, with the files in /etc/apache2 (as root or with sudo). The Services → HTTP tab still edits /var/www/html, the default site’s folder. On Windows Server the service is IIS and it serves that same list of files.'),
        table(['File or folder', 'What it is for'], [
          ['apache2.conf', 'Main configuration: includes the rest and defines the allowed <Directory> entries (/var/www and /usr/share).'],
          ['ports.conf', 'Ports with Listen (80; 443 if ssl is enabled).'],
          ['sites-available/ · sites-enabled/', 'Sites (VirtualHost). Enabled with a2ensite and disabled with a2dissite.'],
          ['mods-available/ · mods-enabled/', 'Modules (a2enmod / a2dismod): alias, dir, autoindex, rewrite, ssl, headers, userdir…'],
          ['conf-available/ · conf-enabled/', 'Configuration snippets (a2enconf / a2disconf): security.conf, charset.conf…'],
        ]),
        h('Workflow'),
        code('admin@srv:~$ sudo mkdir -p /var/www/empresa\nadmin@srv:~$ echo "<h1>Empresa</h1>" | sudo tee /var/www/empresa/index.html\nadmin@srv:~$ sudo nano /etc/apache2/sites-available/empresa.conf\n<VirtualHost *:80>\n    ServerName empresa.aula.lab\n    DocumentRoot /var/www/empresa\n    Alias /docs /srv/docs\n    Redirect /antigua http://www.aula.lab/\n</VirtualHost>\nadmin@srv:~$ sudo a2ensite empresa\nadmin@srv:~$ sudo apache2ctl configtest\nSyntax OK\nadmin@srv:~$ sudo systemctl reload apache2\nalumno@pc0:~$ curl http://empresa.aula.lab/'),
        list(
          'Changes do not take effect until systemctl reload (sites, conf) or restart (modules, ports). If the configuration has errors, reload fails and Apache keeps the previous one; restart leaves it stopped.',
          'apache2ctl configtest shows the error with the file and line: “AH00526: Syntax error on line 16 of …: Invalid command \'DocumentRot\'…”.',
          'Name-based VirtualHost: Apache picks the site from the Host header (ServerName or ServerAlias); if none matches, the first one on that port answers. You need the name in DNS (or curl -H "Host: …").',
          'Permissions: Apache reads as www-data. A DocumentRoot outside /var/www or /usr/share gives 403 Forbidden until you add <Directory …> Require all granted </Directory>. Without index.html, Options Indexes shows the directory listing.',
          'Supported directives: Listen, VirtualHost, ServerName, ServerAlias, DocumentRoot, Alias, Redirect, DirectoryIndex, ErrorDocument, Options, Require, Include/IncludeOptional, IfModule, IfDefine… Those from a disabled module give “Invalid command”.',
          'Changes in /etc/apache2 (including deleted files, such as a disabled site) are saved with the topology.',
        ),
      ],
    },
    {
      id: 'srv-mail',
      title: 'Mail',
      summary: 'SMTP, POP3 and IMAP, domain, accounts and forwarding between domains via MX.',
      blocks: [
        list(
          'SMTP (25, postfix) receives mail; POP3 (110) and IMAP (143) with dovecot deliver it. Each protocol is enabled separately.',
          'The mail domain (aula.lab) decides which addresses are local; users have a name and a password.',
          'If the recipient belongs to another domain, the server looks up its MX in DNS and forwards the message (status=sent relay=…); if it cannot, it returns it (bounced).',
          'POP3 deletes messages from the server when downloading them; IMAP keeps a copy.',
        ),
        code('admin@srv:~$ journalctl -u postfix\n… postfix/smtp[1402]: to=<bea@dos.lab>, relay=mail.dos.lab[10.0.0.2]:25, status=sent (250 2.0.0 Ok)'),
      ],
    },
    {
      id: 'srv-ssh',
      title: 'SSH',
      summary: 'Accounts, remote sessions with bash and editors over SSH; server key in known_hosts.',
      blocks: [
        p('SSH accounts are defined in the panel (username and password). Each session opens a login shell on the server: bash on Ubuntu (it reads ~/.profile and ~/.bashrc) or cmd on Windows. The accounts also exist in the server’s Linux system (/etc/passwd and /home/<user>).'),
        code('alumno@pc0:~$ ssh admin@srv.aula.lab\nThe authenticity of host \'srv.aula.lab (192.168.10.2)\' can\'t be established.\n…\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes\nadmin@srv.aula.lab\'s password:\nWelcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)\nadmin@srv:~$ nano notas.txt        # the editor opens full screen\nadmin@srv:~$ exit 3\nlogout\nConnection to srv.aula.lab closed.\nalumno@pc0:~$ echo $?\n3'),
        list(
          'Three wrong passwords: “Permission denied (publickey,password).”',
          'Service stopped: “Connection refused”; unknown name: “Could not resolve hostname”.',
          'Ctrl+C and Ctrl+D are sent to the remote session.',
          'The server logs every attempt in journalctl -u ssh (Accepted password / Accepted publickey / Failed password).',
          'To log in without a password, using key pairs, see “SSH with key pairs”.',
        ),
      ],
    },
  ],
};
