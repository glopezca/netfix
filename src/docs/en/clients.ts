/** Documentation: client devices (IP configuration, applications and the Windows terminal). */
import type { DocGroup } from '../types.ts';
import { code, h, list, p, table } from '../types.ts';

export const CLIENT_DOCS: DocGroup = {
  id: 'clientes',
  title: 'PC and Windows',
  pages: [
    {
      id: 'pc-ip',
      title: 'IP Config',
      summary: 'Static or DHCP IP, operating system, MAC and Client-ID.',
      blocks: [
        list(
          'Static: address, mask (255.255.255.0 or /24), default gateway and DNS server.',
          'DHCP: the device requests its configuration (DORA) and shows the lease obtained.',
          'Operating system: Ubuntu or Windows. Changes the terminal that opens first and the system an SSH client sees.',
        ),
        h('Client-ID (option 61)'),
        table(['Option', 'What it sends'], [
          ['“Send client identifier” enabled (default)', '01 + MAC, like Windows.'],
          ['Disabled', 'Nothing: the server identifies the client by its MAC.'],
          ['Custom Client-ID (hexadecimal)', 'The given bytes, e.g. 0100.50f0.0000.02.'],
          ['Custom Client-ID (ASCII text)', 'The text as bytes, e.g. PC-profesor.'],
        ]),
      ],
    },
    {
      id: 'pc-equipo',
      title: 'Device name',
      summary: 'Display name, host name and pretty name; equivalents on Linux and Windows.',
      blocks: [
        p('The Device tab of PCs and servers separates two names: the display name (the icon’s label on the workspace) and the system’s host name. The host name is sent by the DHCP client (option 12, visible in show ip dhcp binding and in Kea), appears in the GNU/Linux prompt, in /etc/hostname and in hostname, and is saved with the topology.'),
        table(['Where', 'How to change it', 'Persistent'], [
          ['Device tab', 'Host name + Save', 'Yes'],
          ['GNU/Linux', 'sudo hostnamectl set-hostname NOMBRE', 'Yes (/etc/hostname)'],
          ['GNU/Linux', 'echo NOMBRE | sudo tee /etc/hostname', 'Yes'],
          ['GNU/Linux', 'sudo hostname NOMBRE', 'No: transient name until reboot'],
          ['GNU/Linux', 'sudo hostnamectl set-hostname --pretty "Texto libre"', 'Yes (pretty name)'],
        ]),
        code('admin@srv:~$ hostnamectl set-hostname web01\n==== AUTHENTICATING FOR org.freedesktop.hostname1.set-static-hostname ====\nAuthentication is required to set the statically configured local hostname, as well as the pretty hostname.\nAuthenticating as: admin\nPassword:\n==== AUTHENTICATION COMPLETE ====\nadmin@srv:~$ exec bash\nadmin@web01:~$ hostnamectl | head -1\n Static hostname: web01'),
        list(
          'As in Ubuntu, bash reads the name at start-up: the prompt changes in a new shell (exec bash or a new terminal).',
          'Rules (RFC 1123): unaccented letters, digits and hyphens; labels of up to 63 characters separated by dots; no spaces.',
        ),
      ],
    },
    {
      id: 'pc-apps',
      title: 'Web Browser and mail',
      summary: 'PC desktop applications.',
      blocks: [
        list(
          'Web Browser: http://IP or http://name. Resolves via DNS, follows links and renders the page safely, without running scripts.',
          'Mail: account with an incoming server (POP3 or IMAP) and an outgoing one (SMTP). Compose, Send and Receive. POP3 deletes from the server; IMAP keeps a copy.',
        ),
      ],
    },
    {
      id: 'windows-cmd',
      title: 'Windows terminal (cmd)',
      summary: 'cmd.exe commands available on Windows PCs and servers.',
      blocks: [
        table(['Command', 'Usage'], [
          ['ipconfig [/all]', 'IP configuration; /all adds MAC, DHCP server, DNS and lease dates.'],
          ['ipconfig /release · ipconfig /renew', 'Releases or renews the DHCP lease.'],
          ['ping [-n N] destino', 'ICMP echo (4 by default).'],
          ['tracert [-h N] destino', 'Hop-by-hop route (see “traceroute and tracert”).'],
          ['arp -a · arp -d', 'Shows or clears the ARP cache.'],
          ['nslookup nombre [servidor]', 'DNS lookup.'],
          ['netstat -an', 'Listening ports and connections.'],
          ['curl [-I] URL', 'HTTP client.'],
          ['ssh usuario@host', 'SSH client (also to Ubuntu servers: opens bash).'],
          ['sc query [svc] · sc start|stop svc', 'Windows Server services (W3SVC, DNS, DHCPServer, SMTPSVC, POP3Svc, sshd).'],
          ['net start [svc] · net stop svc', 'Same as sc, with net’s messages.'],
          ['hostname · whoami · ver · cls · help', 'System and help.'],
        ]),
        code('C:\\> ipconfig /renew\nC:\\> nslookup www.aula.lab\nC:\\> ssh admin@192.168.10.2'),
        p('Errors mimic Windows: “… is not recognized as an internal or external command”, “Request timed out.”, “FAILED 1060”…'),
      ],
    },
  ],
};
