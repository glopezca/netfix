/** Documentation: client devices (IP configuration, applications and the Windows terminal). */
import type { DocGroup } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

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
      summary: 'Device name, derived host name (not changed from the terminal) and pretty name.',
      blocks: [
        p('In the Device tab of PCs, servers, Linux routers and clouds you type the device name (the one in the diagram); it applies on Enter or when leaving the field. The system host name is always derived from it in standard form: lowercase, no accents and hyphens instead of spaces («Aula Pública 2º» → aula-publica-2o). It shows in the tab, read-only, and cannot be changed any other way, so every device of the diagram has a predictable host name. The diagram shows the device name and the IP/CIDR of each configured interface (for a cloud, its public block), without repeating the host name. The DHCP client sends the host name (option 12, visible in show ip dhcp binding and in Kea) and it appears in the GNU/Linux prompt, in /etc/hostname and in hostname.'),
        table(['Where', 'What happens in Netfix'], [
          ['Device tab', 'Changes the device name and, with it, the host name.'],
          ['sudo hostnamectl set-hostname NAME', 'Asks for the password and answers «Could not set static hostname: in Netfix the host name comes from the device name».'],
          ['sudo hostname NAME · sysctl -w kernel.hostname=…', 'Refused for the same reason.'],
          ['/etc/hostname', 'Generated read-only file (Read-only file system).'],
          ['Web management → Setup', 'Shows the host name without a field to change it.'],
          ['sudo hostnamectl set-hostname --pretty "Free text"', 'Does change the pretty name, saved with the topology.'],
        ]),
        code('alumno@pc0:~$ sudo hostnamectl set-hostname web01\nCould not set static hostname: in Netfix the host name comes from the device name (Device tab)\nalumno@pc0:~$ hostnamectl | head -1\n Static hostname: pc0'),
        list(
          'On a real Ubuntu those commands do change the name; Netfix blocks them so the host name always comes from the diagram.',
          'Host name rules (RFC 1123): unaccented letters, digits and hyphens; up to 63 characters; no spaces.',
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
      summary: 'cmd.exe commands available on Windows PCs and servers, files included.',
      blocks: [
        p('The Windows terminal works on the same file system as the device’s Linux terminal: drive C:\\ is the root /, folders are separated by \\ (or /) and names are not case-sensitive. It starts in the home folder of the Linux account (C:\\home\\alumno on PCs, C:\\home\\admin on servers) and keeps its permissions: whatever that account cannot write gives “Access is denied.”.'),
        note('«Date and time stamped prompt» checkbox (at the foot of the terminal): the prompt becomes the one of this PowerShell prompt function: date and time (Get-Date "ddd MMM dd" and "HH:mm:ss") in dark cyan, user@host in green, the path in yellow and $ (# for an administrator account). For example: Thu Oct 22 18:28:05 user@pc0 C:\\home\\alumno$. It is shared with the Linux terminal of the device.'),
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
          ['cd [folder] · cd ..', 'Changes folder; with no argument it shows the current one.'],
          ['dir [path] [/b]', 'Lists a folder (* and ? allowed); /b names only.'],
          ['md folder · rd [/s] [/q] folder', 'Creates folders (the intermediate ones too) or removes them; /s with their contents, after asking “Are you sure (Y/N)?” unless /q is given.'],
          ['del [/q] file · copy [/y] source destination · move [/y] source destination · ren file name', 'Deletes, copies, moves or renames files (* and ? allowed; *.* is everything). del of a folder or of *.* asks first unless /q; copy and move ask before overwriting unless /y; copy of several files onto one joins them; move also moves or renames folders.'],
          ['type file', 'Shows the contents of a file.'],
          ['edit file', 'Full-screen editor (Microsoft Edit): Ctrl+S saves, Ctrl+Q or Esc exits and asks if there are changes, Ctrl+F finds (F3 next), Ctrl+G goes to a line, Ctrl+Z/Ctrl+Y undo and redo. F10 (also on the touch key bar) or Alt+letter opens the File, Edit, View and Help menus: the highlighted letter of each menu and item is the one that picks it; arrows to move, Enter to choose and Esc to close. A file the account cannot write opens read-only.'],
          ['echo text · command > file · command >> file', 'echo prints the text (echo. a blank line); > saves the output of any command to a file, >> appends it and > nul discards it.'],
        ]),
        code('C:\\home\\alumno> ipconfig /all > net.txt\nC:\\home\\alumno> type net.txt\nC:\\home\\alumno> edit notes.txt\nC:\\home\\alumno> copy notes.txt \\tmp\nC:\\home\\alumno> ssh admin@192.168.10.2'),
        p('What is created here shows up in the Linux terminal (cat ~/net.txt, nano ~/notes.txt) and the other way round.'),
        p('Errors mimic Windows: “… is not recognized as an internal or external command”, “Request timed out.”, “FAILED 1060”…'),
      ],
    },
  ],
};
