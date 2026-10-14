/** Documentation: Server web applications (Roundcube and web management). */
import type { DocPage } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const WEBAPP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-roundcube',
    title: 'Roundcube (webmail)',
    summary: 'Webmail on top of the server’s IMAP and SMTP, on an Apache alias or on its own port.',
    blocks: [
      p('Services → HTTP → Web applications: enable Roundcube and choose how it is reached, so that it does not take port 80 or the root / of the main website.'),
      table(['Access', 'URL from a PC', 'Notes'], [
        ['URL alias in Apache (default /roundcube)', 'http://servidor/roundcube/', 'Served by Apache: /etc/apache2/conf-enabled/roundcube.conf. Needs the HTTP service enabled.'],
        ['Own port (default 8080)', 'http://servidor:8080/', 'Listens even when Apache is stopped.'],
      ]),
      list(
        'Log in with one of the server’s mail users (Services → Email); IMAP must be enabled.',
        'Inbox, Sent and Trash; read, compose, reply, forward and delete.',
        'Messages to other domains are delivered over SMTP to the MX server given by DNS.',
        'The session is kept in the roundcube_sessid cookie; the generated configuration is in /etc/roundcube/config.inc.php.',
      ),
      note('With DNS, a CNAME webmail → srv lets you type http://webmail.aula.lab/roundcube/.'),
    ],
  },
  {
    id: 'srv-webadmin',
    title: 'Server web management',
    summary: 'Home-router-style administration interface: basic settings, DHCP, DNS, web, email, SSH, status and logs.',
    blocks: [
      p('Services → HTTP → Web applications → Web management. It is disabled by default; once enabled it listens on port 10000 (or on an Apache alias such as /admin) with user admin and password admin.'),
      code('PC Web Browser:    http://srv.aula.lab:10000/\nTerminal:          curl -u admin:admin "http://192.168.10.2:10000/?page=status"'),
      table(['Page', 'What it changes'], [
        ['Config', 'Host name, static or DHCP IP, default gateway and DNS.'],
        ['DHCP', 'Enable the server, add and delete pools (leases by MAC or by Client-ID), addresses reserved by MAC or identifier (hex 01… or text) and “Reserve” an active lease.'],
        ['DNS', 'Enable bind9, zone domain and records (A, CNAME, MX, NS, TXT; @ and * allowed).'],
        ['Web', 'Apache and access to Roundcube.'],
        ['Email · SSH', 'Services and users; for SSH, the authentication methods (password and/or key pair) in sshd_config.'],
        ['Administration', 'Interface user/password and its port or alias (when changed, the browser moves to the new address).'],
        ['Status · Logs', 'Device data, services, leases and latest messages (journalctl).'],
      ]),
      h('Security'),
      list(
        'HTTP Basic authentication (realm “Server”); failed attempts are logged in journalctl -u apache2.',
        'Every change is validated exactly as in the server window and logged with the user and the PC’s IP.',
      ),
    ],
  },
];
