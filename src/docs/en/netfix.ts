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
          'In order: PC, Server, IOS switch (2960-24TT), IOS router (2911), Linux router (Ubuntu on 2911 hardware) and Cloud (ISP → Internet). Both routers sit together and share the router symbol. Pick one and click (or tap) on the workspace.',
          'Cable: click a device, choose the port, and repeat at the other end. The cable type is chosen automatically.',
          'Select: drag devices; double-click opens their window. With a device or a cable selected, Del or Backspace removes it (a device takes its cables with it).',
          'Delete: removes devices or cables.',
          'Drawing: opens the bar to mark areas, draw lines and write labels (see “Drawing”).',
        ),
        h('Device windows'),
        table(['Device', 'Tabs'], [
          ['IOS router / IOS switch', 'Device (workspace name and hostname), Interfaces (state, MAC, far end of the cable, description, address or VLAN and shutdown, applied as CLI commands), CLI (Cisco IOS 15) and Web management (ip http server).'],
          ['ISP Cloud', 'ISP (provider, public block, domains), Interfaces (summary of the six lines) and Lines (mode, LAN, NAT, port forwarding).'],
          ['PC', 'Device, Interfaces (MAC, link, speed, far end of the cable and port status), IP Config, Web Browser, Mail, SSH client, Files (SFTP), Windows terminal and Linux terminal.'],
          ['Linux router', 'Device, Interfaces (address of eth0-eth2, MAC, far end of the cable, forwarding and routes), Services (Parameters, Firewall, VPN, and the Server services) and Linux terminal.'],
          ['Server', 'Device, Interfaces, Services (DHCP, DNS, HTTP, mail, SSH), IP Config, Linux terminal and Windows terminal. No kernel or firewall panels: they belong to the Linux router (sysctl and nft remain in its terminal).'],
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
      id: 'dibujo',
      title: 'Drawing: areas, lines and labels',
      summary: 'Mark networks with coloured areas, draw straight or freehand lines and write labels on the workspace.',
      blocks: [
        p('The Drawing button of the palette opens a floating bar to annotate the diagram: mark the private network, the DMZ or the Internet, write the network address or show a tunnel. Drawings do not change the simulated network and are saved with the topology.'),
        table(['Tool', 'Use'], [
          ['▭ Rectangle · ◯ Ellipse', 'Drag to mark an area. When released it asks for its name (for example “LAN · 192.168.1.0/24”); Escape leaves it unnamed.'],
          ['╱ Line · ✎ Freehand', 'Drag to draw a straight or free line (a tunnel, a traffic flow, an underline).'],
          ['T Text label', 'Click where the text goes and type it; Enter accepts.'],
          ['Colours', 'Nine basic colours and an RGB picker for any other; the current one is shown on the left.'],
          ['Fill · width', 'Areas can have a light fill of their colour; the stroke width goes from 1 to 6 px.'],
        ]),
        list(
          'With Select, drag a drawing by its border or its text to move it; the inside of an area lets clicks through to the background and the devices.',
          'Double-click an area or label: change its text. With a drawing selected, picking another colour, fill or width changes it.',
          'To delete a drawing: select it and press Delete drawing on the bar (or the Del key), or choose the Delete tool and tap the drawing; with it, tapping inside an area is enough.',
          'Delete all (on the bar, after confirming) removes every drawing, the areas that come with a lab too; devices and cables are not changed.',
          'The labs already come with areas for the private networks, the Internet, the DMZ, guests, servers, VLANs and VPN tunnels.',
        ),
        note('Drawings go below cables and devices, and “Fit to network” takes them into account too.'),
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
        code('1. Click “Simulation”.\n2. On a PC: Windows terminal → ipconfig /release and ipconfig /renew\n   (or Linux Terminal → sudo dhclient -r eth0 && sudo dhclient eth0).\n3. Click “Step” and watch DISCOVER, OFFER, REQUEST and ACK.'),
      ],
    },
  ],
};
