/** Documentation: the Server's web applications (Roundcube and web management), in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const WEBAPP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-roundcube',
    title: 'Roundcube (webmail)',
    summary: 'Reading and writing mail from the browser, on an Apache alias or on a port of its own.',
    markdownBase: MD,
    blocks: [
      p('**Roundcube** is webmail: users read and write their mail from the browser, without setting up any client. Underneath it uses the same server’s **IMAP** and **SMTP**, so it needs the mail service working.'),
      h('Step by step'),
      steps(
        ['Switch it on', '**Services → HTTP → Web applications → Roundcube (webmail)**: **Enabled**.'],
        ['Choose the access', '**URL alias in Apache** (/roundcube by default) or **Own port** (8080 by default), and **Apply**. That way it takes neither port 80 nor the root / of the main website.'],
        ['Log in', 'In a PC’s browser, the URL of the chosen access; log in with a user from **Services → Email**.'],
      ),
      table(['Access', 'URL from a PC', 'Notes'], [
        ['URL alias in Apache', 'http://server/roundcube/', 'Served by Apache: /etc/apache2/conf-enabled/roundcube.conf. Needs the HTTP service on.'],
        ['Own port', 'http://server:8080/', 'Listens even with Apache stopped.'],
      ]),
      list(
        'Inbox, Sent and Trash; read, compose, reply, forward and delete.',
        'Messages to other domains are delivered over SMTP to the MX server that DNS names.',
        'The session goes in the roundcube_sessid cookie; the generated configuration is in /etc/roundcube/config.inc.php.',
      ),
      tip('An easy name', 'With a CNAME `webmail` → `srv` in DNS, users type http://webmail.aula.lab/roundcube/.'),
      check('Check it with curl', 'Apache answers 200 OK if the alias works.'),
      term('shell', 'alumno@pc1:~$ curl -sI http://webmail.aula.lab/roundcube/\nHTTP/1.1 200 OK\nDate: Sat, 24 Oct 2026 06:31:21 GMT\nServer: Apache/2.4.62 (Ubuntu)\nContent-Length: 682\nContent-Type: text/html; charset=UTF-8'),
      warn('Common mistakes', 'You cannot log in: IMAP is off or the user does not exist in Services → Email. 404 on /roundcube/: the access is on its own port, not the alias. Nothing loads with the alias: the HTTP service is stopped.'),
      exercise('Luis reads his mail on the web', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, send a message from ana to luis from PC0 and read it with Roundcube in PC1’s browser.', 'PC0 → Email → Compose to luis@aula.lab → Send. On PC1 → Web Browser: http://webmail.aula.lab/roundcube/, user luis and password luis1: the message is in the Inbox. If you downloaded it over POP3 with Receive first, it is no longer on the server.'),
    ],
  },
  {
    id: 'srv-webadmin',
    title: 'Server web management',
    summary: 'Managing the server from the browser: menu, pages and the interface’s security.',
    markdownBase: MD,
    blocks: [
      p('**Web management** is an administration interface in the browser, like a home router’s or a Webmin-style panel: the same as the Services tab, but from any PC on the network. Every change is validated as in the server’s window and applies at once.'),
      h('Step by step'),
      steps(
        ['Switch it on', '**Services → HTTP → Web applications → Server web management**: **Enabled** (it is off by default). It listens on port 10000 or on an Apache alias such as /admin.'],
        ['Set user and password', 'admin and netfix by default (the same account as the labs’ SSH). Change them on the **Management** page.'],
        ['Log in', 'In a PC’s browser, http://srv.aula.lab:10000/ (or http://srv.aula.lab/admin/). The browser asks for user and password.'],
      ),
      table(['Menu', 'Page', 'What it changes'], [
        ['Setup', 'Basic setup', 'Host name (read only), static or DHCP IP address, gateway and DNS.'],
        ['Services', 'SSH', 'Service, users and authentication methods (password and/or key pair) of sshd_config.'],
        ['Services', 'DHCP', 'Server, listen interfaces, pools (leases by MAC or by Client-ID), reservations and “Reserve” for an active lease.'],
        ['Services', 'DNS', 'Listen interfaces, cards of the five modes with their switch and uses, the zone wizard and, beside them, the generated BIND configuration, explained.'],
        ['Services', 'Web and webmail', 'Apache and the access to Roundcube.'],
        ['Services', 'Email', 'Protocols, domain and accounts.'],
        ['Security (Linux router)', 'Routing · Firewall · VPN', 'Packet forwarding and static routes, nftables rules and WireGuard. A Server does not have it.'],
        ['Administration', 'Management', 'User, password and port or alias of the interface (when changed, the browser moves to the new address).'],
        ['Status', 'Device · Configuration · Logs', 'Device data, services and leases; the configuration files with vim’s colours (Linux only); the latest messages (journalctl).'],
      ]),
      check('Check it with curl', 'Without credentials it answers **401 Unauthorized** with `Www-Authenticate: Basic realm="Server"`; with `-u user:password`, the page.'),
      term('shell', 'alumno@pc1:~$ curl -s -u admin:netfix "http://192.168.10.2:10000/?page=status" | head -1\n<!doctype html>\nalumno@pc1:~$ curl -s -u admin:mal http://192.168.10.2:10000/ -o /dev/null -w "%{http_code}\\n"\n401'),
      h('Security'),
      list(
        'HTTP Basic authentication (realm “Server”): user and password travel unencrypted with every request (HTTPS is not simulated). On a real network, this interface should only be reachable from the management network.',
        'Failed attempts and every change go into apache2’s log, with the user and the PC’s IP address.',
      ),
      term('messages', 'Oct 24 06:31:28 srv apache2[903]: netfix-webui: access denied for “admin” from 192.168.10.50\nOct 24 06:31:28 srv apache2[903]: 192.168.10.50 - - "GET / HTTP/1.1" 401 191 (port 10000)'),
      note('The Linux router has the same web management, with the Security menu; IOS routers and switches have their own, with a different look.'),
      note('Whatever the device’s Settings tab or the lab turn off is greyed out in the menu, and its page only says so; with “Hide disabled options in the web management…” (Settings → Current lab) it is not shown.'),
      exercise('Who tried to get in?', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, try to log in to web management from PC1 with a wrong password and then with the right one. Find both attempts on the server.', 'PC1 → Web Browser → http://srv.aula.lab:10000/: with a wrong password it asks again. On SRV → Services → Logs → apache2 there is “netfix-webui: access denied for “admin” from 192.168.10.50” and the request with code 401.'),
    ],
  },
];
