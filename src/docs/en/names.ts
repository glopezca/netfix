/** Documentation: name resolution (hosts, DNS, mDNS, LLMNR and NetBIOS), how each system chooses and its labs. */
import type { DocPage } from '../types.ts';
import { check, code, exercise, figure, h, list, p, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const NAMES_DOCS: readonly DocPage[] = [
  {
    id: 'red-nombres',
    title: 'Name resolution: hosts, DNS, mDNS, LLMNR and NetBIOS',
    summary: 'Five ways to get from a name to an IP address, which one each system uses and in what order, what crosses a router and how to watch it in Simulation.',
    markdownBase: MD,
    blocks: [
      p('Before it sends `ping pc2`, a device needs pc2’s **IP address**. There are several ways to find it: a local file, a DNS server or asking the whole local network. Windows and GNU/Linux try them in a different order, and only one of them crosses routers.'),
      h('The protocols'),
      table(['Protocol', 'Names', 'How it asks', 'Reach', 'Who answers in Netfix'], [
        ['hosts', 'Any', 'Reads the device’s /etc/hosts file', 'The device itself', 'Nobody: it is local'],
        ['DNS', 'With a domain (and without a dot, with the search suffix)', 'Unicast, UDP 53, to the configured DNS server', 'Crosses routers', 'A DNS server (bind9, 8.8.8.8…)'],
        ['mDNS', 'Ending in .local', 'Multicast 224.0.0.251, UDP 5353', 'The link: does not cross routers', 'Windows out of the box; GNU/Linux with avahi-daemon'],
        ['LLMNR', 'Single-label (pc2)', 'Multicast 224.0.0.252, UDP 5355, TTL 1', 'The link: does not cross routers', 'Windows out of the box'],
        ['NetBIOS (NBNS)', 'Single-label, up to 15 characters', 'Subnet broadcast, UDP 137', 'The subnet: does not cross routers', 'Windows out of the box; GNU/Linux with samba'],
      ]),
      p('mDNS, LLMNR and NetBIOS need no server: they ask every device on the link and the one with that name answers. That is why they work in a home network or a classroom with no DNS of its own, but not to reach another network.'),
      h('Order on Windows'),
      list(
        'The hosts file (in Netfix, the device’s /etc/hosts, the same one as its GNU/Linux terminal).',
        'If the name ends in **.local**: mDNS (and, if nobody answers, the DNS).',
        'The **DNS**, with the search suffix: `ping srv` asks for srv.aula.lab if DHCP gave the domain aula.lab.',
        'If the DNS does not know it and the name is **single-label**: **LLMNR and NetBIOS at once**. The LLMNR answer wins; the NetBIOS one only counts if LLMNR finds nothing.',
      ),
      figure({
        type: 'sequence',
        actors: ['WIN1', '8.8.8.8 (DNS)', 'The whole LAN', 'WIN2'],
        messages: [
          { from: 0, to: 1, text: 'DNS A? win2', note: 'UDP 53 (with the suffix, if any)' },
          { from: 1, to: 0, text: 'NXDOMAIN', note: 'the public DNS does not know win2' },
          { from: 0, to: 2, text: 'LLMNR A? win2', note: 'multicast 224.0.0.252:5355' },
          { from: 0, to: 2, text: 'NBNS Query WIN2<00>', note: 'broadcast 192.168.1.255:137' },
          { from: 3, to: 0, text: 'LLMNR: 192.168.1.12', note: 'unicast from 5355' },
          { from: 3, to: 0, text: 'NBNS Response', note: 'unicast; it stays in the cache (nbtstat -c)' },
        ],
      }, '`ping win2` from WIN1 in the “Names in a LAN with no DNS of its own” lab. In Simulation, with the DNS, LLMNR and NBNS filters.'),
      h('Order on GNU/Linux'),
      p('glibc follows the `hosts:` line of **/etc/nsswitch.conf**, from left to right. Ubuntu Server ships `files dns`: the /etc/hosts file, then the DNS. Each package adds its source:'),
      table(['Source', 'Package', 'How it is added'], [
        ['files', '(base)', 'Out of the box: /etc/hosts.'],
        ['dns', '(base)', 'Out of the box: the servers in /etc/resolv.conf.'],
        ['mdns4_minimal [NOTFOUND=return]', 'libnss-mdns (avahi-daemon brings it)', 'Its installation adds it and its removal takes it away. It only asks .local names; if nobody answers, it does not go on to the DNS.'],
        ['wins', 'winbind and libnss-winbind', 'By hand, as on a real Ubuntu.'],
      ]),
      code('hosts:          files mdns4_minimal [NOTFOUND=return] dns wins'),
      p('Netfix’s GNU/Linux devices do not speak LLMNR: they neither ask nor answer. For Windows to find a GNU/Linux device by its name, install **avahi-daemon** (pc.local) or **samba** (a name without a dot, through NetBIOS) on it.'),
      warn('A PC with both terminals', 'A PC’s Windows terminal resolves the Windows way (mDNS, LLMNR and NetBIOS out of the box) and its GNU/Linux terminal the GNU/Linux way: without avahi, `ping pc2.local` fails there even though it works in the Windows terminal.'),
      h('Tools'),
      table(['Command', 'System', 'What it does'], [
        ['ping NAME', 'Both', 'Resolves as the system does and shows the IP address it got.'],
        ['nslookup · dig · host', 'Both / GNU/Linux', 'Ask **only the DNS**: they do not use hosts, mDNS, LLMNR or NetBIOS.'],
        ['nbtstat -n · -a · -A · -c · -R', 'Windows', 'Own or remote NetBIOS table, cache and purge.'],
        ['nmblookup NAME · -A IP', 'GNU/Linux with samba', 'NetBIOS query by broadcast, or a device’s table.'],
      ]),
      term('cmd', 'C:\\>ping -n 1 win2\n\nPinging win2 [192.168.1.12] with 32 bytes of data:\n\nReply from 192.168.1.12: bytes=32 time<1ms TTL=128'),
      tip('Watch it in Simulation', 'Switch to **Simulation**, keep DNS, MDNS, LLMNR and NBNS ticked and run the ping: you will see the DNS question, the LLMNR multicast (MAC 01:00:5e:00:00:fc, TTL 1), the NBNS broadcast and the unicast answers. Click each event to see its PDU.'),
      h('Labs'),
      p('Under **Labs… → Name resolution** there are three exercises: “Names in a LAN with no DNS of its own”, “Names across networks” and “Company DNS forwarding to the Internet”.'),
      exercise('Four devices, four ways', 'In “Names in a LAN with no DNS of its own”, get every device to ping the other three by name and write down which protocol resolves each case.', 'WIN1 ↔ WIN2: LLMNR (`ping win2`) or mDNS (`ping win2.local`). WIN → LNX1: `ping lnx1.local` (avahi answers). LNX1 → WIN: `ping win1.local` (avahi asks). LNX2 neither asks nor answers: `echo "192.168.1.11 win1" | sudo tee -a /etc/hosts` (hosts), or `sudo apt install samba` so that Windows finds it through NetBIOS (`ping lnx2`) and `sudo apt install avahi-daemon` so that it asks .local names.'),
      exercise('What does not cross the router', 'In “Names across networks”, from WIN-A, `ping win-b` works and `ping win-b2` does not. From WIN-B, `ping win-b2` does. Explain why and fix it without touching WIN-A.', 'win-b is in SRV’s aula.lab zone and the DNS crosses the router; win-b2 is not, and LLMNR and NetBIOS stay in LAN B (multicast with TTL 1 and subnet broadcast). From WIN-B, WIN-B2 answers through LLMNR. On SRV (Services → DNS → aula.lab) add the record `win-b2` A 192.168.20.12: `ping win-b2` from WIN-A resolves win-b2.aula.lab.'),
      check('Check it', '`nslookup win-b2` from WIN-A answers 192.168.20.12, and in Simulation there are no more LLMNR or NBNS packets: the DNS resolved it first.'),
    ],
  },
];
