/** Documentation: using Netfix (interface, users, saving, simulation). */
import type { DocGroup } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const NETFIX_DOCS: DocGroup = {
  id: 'netfix',
  title: 'Netfix',
  pages: [
    {
      id: 'inicio',
      title: 'Getting started',
      summary: 'The interface: top bar, workspace, device palette and windows.',
      blocks: [
        p('Netfix is an in-browser network simulator with the look and behaviour of Cisco Packet Tracer. Everything runs on your computer: there is no server and nothing is sent to the Internet (the “Internet” of the ISP clouds is simulated too).'),
        h('Top bar'),
        table(['Control', 'What it does'], [
          ['Network / Documentation / Donations / About', 'Switches between the workspace, this documentation, the page for supporting the project (PayPal.Me) and the version, authorship, licence and attribution information (taken from package.json and LICENSE.md).'],
          ['New · Open… · Save', 'Empty workspace, open a .json file or save the topology (Ctrl+S).'],
          ['Labs…', 'Loads a ready-made exercise: DHCP (basic, reservations, relay, VLAN, snooping, client router), Server, Internet with two sites, IPsec and WireGuard VPN, Linux router with DMZ, forwarding DNS, SSH/SFTP and hardening.'],
          ['Clock and “Advance clock…”', 'Simulated time. Moving it forward 1 minute, 1 hour or 1 day makes DHCP leases expire or renew.'],
          ['Realtime / Simulation', 'Execution mode (see “Realtime and simulation”).'],
          ['Language', 'Español (España) or English (UK): changes the whole interface, the documentation and the simulated web pages without reloading.'],
        ]),
        h('Palette and tools'),
        list(
          '2911 Router, 2960-24TT Switch, PC, Server, Linux router and ISP Cloud: pick one and click (or tap) on the workspace.',
          'Cable: click a device, choose the port, and repeat at the other end. The cable type is chosen automatically.',
          'Select: drag devices; double-click opens their window.',
          'Delete: removes devices or cables.',
        ),
        h('Device windows'),
        table(['Device', 'Tabs'], [
          ['Router / Switch', 'CLI (Cisco IOS 15) and Web management (ip http server).'],
          ['ISP Cloud', 'ISP (provider, public block, domains) and Lines (mode, LAN, NAT, port forwarding).'],
          ['PC', 'IP Config, Web Browser, Mail, SSH client, Files (SFTP), Device, Command Prompt and Linux Terminal.'],
          ['Linux router', 'Services (firewall, sysctl, VPN…), Interfaces, Device and Linux Terminal.'],
          ['Server', 'Services, IP Config, Device, Linux Terminal and Command Prompt.'],
        ]),
        note('Windows are moved by their title bar and resized from the corner. Escape closes the active window (except inside nano or vim). On phones and tablets windows fill the screen, the canvas is panned with one finger and zoomed by pinching, a long press opens a device and the terminal has a key bar (Esc, Tab, Ctrl, arrows).'),
      ],
    },
    {
      id: 'usuarios',
      title: 'Users and passwords',
      summary: 'Terminal, SSH and mail accounts in the labs.',
      blocks: [
        p('All of these are fictitious lab credentials. SSH and mail accounts are changed in the server’s Services tab.'),
        h('Lab “Server: DHCP, DNS, web, mail and SSH”'),
        table(['Use', 'User', 'Password', 'Where'], [
          ['Mail (IMAP)', 'ana → ana@aula.lab', 'ana1', 'Mailbox on srv; account set up in PC0’s Mail'],
          ['Mail (POP3)', 'luis → luis@aula.lab', 'luis1', 'Mailbox on srv; account set up in PC1’s Mail'],
          ['SSH', 'admin', 'cisco', 'ssh admin@srv.aula.lab or ssh admin@192.168.10.2'],
        ]),
        h('Terminal accounts'),
        table(['Device', 'GNU/Linux', 'Windows'], [['PC', 'alumno', 'user'], ['Server', 'admin', 'Administrator']]),
        h('Linux system accounts on each device'),
        table(['Account', 'UID', 'Groups', 'Notes'], [
          ['root', '0', 'root', 'No password: su does not let you in; use sudo -i.'],
          ['alumno (PC) / admin (server)', '1000', 'alumno|admin, adm, sudo, users', 'Local terminal user. Can use sudo.'],
          ['Server SSH accounts', '1001–9999 (fixed per name)', 'own group, users', 'One per SSH user; they are not in the sudo group.'],
        ]),
        p('sudo asks for the account’s password when an SSH account with that name exists (admin/cisco in the lab) and remembers it for 15 minutes, as Ubuntu does. PCs have no SSH accounts, so sudo does not ask for a password.'),
        code('admin@srv:~$ sudo systemctl restart apache2\n[sudo] password for admin:\nadmin@srv:~$ sudo -i\nroot@srv:~#'),
      ],
    },
    {
      id: 'guardar',
      title: 'Saving and opening',
      summary: 'What the .json file stores and how it is restored.',
      blocks: [
        p('Save (or Ctrl+S) creates a .json file with the whole architecture. In Chrome and Edge a dialogue appears for choosing the name and folder; in other browsers it is downloaded. The workspace is also saved automatically in the browser.'),
        list(
          'Positions of devices and cables.',
          'IOS configuration (running-config and startup-config).',
          'IP, Client-ID and operating system of PCs and servers.',
          'Services, DNS records, DHCP pools and reservations, web pages, mailboxes and mail accounts.',
          'Files created or modified from the Linux Terminal (home, scripts, changes in /etc, bash history).',
        ),
        note('Limits for terminal files: 256 KiB per file and 4 MiB per device. Generated files (service configuration) are not saved: they are recalculated.'),
        p('Open… validates the file before using it and still accepts the previous format (v1).'),
      ],
    },
    {
      id: 'simulacion',
      title: 'Realtime and simulation',
      summary: 'Watching packets step by step: event list, PDU and protocol filters.',
      blocks: [
        p('In Realtime the network runs on its own. In Simulation, every packet stays in the event list and can be replayed step by step, as in Packet Tracer.'),
        list(
          'Play / Pause / Step: advance the simulation.',
          'Filters: DHCP, DNS, ARP, ICMP, TCP, HTTP, SMTP, POP3, IMAP and SSH.',
          'Choosing an event shows the PDU by layers (Ethernet II, IPv4, UDP/TCP and the application message).',
          'SSH appears as “encrypted data”: its content cannot be read in transit.',
        ),
        h('Example: watching the DHCP DORA'),
        code('1. Click “Simulation”.\n2. On a PC: Command Prompt → ipconfig /release and ipconfig /renew\n   (or Linux Terminal → sudo dhclient -r eth0 && sudo dhclient eth0).\n3. Click “Step” and watch DISCOVER, OFFER, REQUEST and ACK.'),
      ],
    },
  ],
};
