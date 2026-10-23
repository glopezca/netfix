/** Documentation: ISP cloud, emulated Internet, public DNS, IOS NAT, IOS web management and traceroute. */
import type { DocGroup } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const INTERNET_DOCS: DocGroup = {
  id: 'internet',
  title: 'Internet and NAT',
  pages: [
    {
      id: 'inet-cloud',
      title: 'ISP cloud',
      summary: 'Cable, xDSL and fibre lines: public IP via DHCP or an ISP router with NAT and port forwarding.',
      blocks: [
        p('The Cloud (palette → Cloud) emulates an ISP’s Internet uplink. It has six ports, one per customer line: Coaxial0-1 (DOCSIS cable), DSL0-1 (VDSL2) and Fibra0-1 (FTTH). Connect a router (GigabitEthernet), a switch or a PC to each one.'),
        table(['Line mode', 'What it does', 'When to use it'], [
          ['ISP router (default)', 'It is the home router: LAN 192.168.1.1/24, DHCP from .33 (DNS 8.8.8.8 and 8.8.4.4), NAT of the whole LAN to the public IP x.y.n.2 and port forwarding.', 'Connecting PCs, a switch or a server directly.'],
          ['Public IP (/29)', 'The cloud is the gateway x.y.n.1/29 and hands out x.y.n.2 to your router via DHCP; .3-.6 are left free for static NAT.', 'Configuring NAT yourself on a Cisco 2911 (ip address dhcp + ip nat).'],
        ]),
        h('Addresses'),
        list(
          'Each cloud has its own public /16 block (the first 81.32.0.0, the second 81.33.0.0…). Port number i (Coaxial0 = 1, Coaxial1 = 2, DSL0 = 3, DSL1 = 4, Fibra0 = 5, Fibra1 = 6) uses x.y.i.0/29.',
          'The ISP router on the backbone is x.y.0.1 and appears in traceroute.',
          'Each line has its own IP plane: several lines can use 192.168.1.0/24 at the same time.',
        ),
        h('Cloud window'),
        list(
          'ISP: provider name, public block and registered domains.',
          'Lines: mode, contracted speeds (informational), LAN IP and mask, DHCP leases, NAT translations and port forwarding (TCP or UDP, public port → LAN IP:port).',
        ),
        note('Without forwarding rules, only the router itself answers from the Internet (ping to the WAN); any other port returns RST: curl says “Connection refused”.'),
      ],
    },
    {
      id: 'inet-dns',
      title: 'Emulated Internet and public DNS',
      summary: 'Backbone routers, 8.8.8.8/8.8.4.4, test websites, registered domains and NS delegation.',
      blocks: [
        p('All the clouds in the workspace are joined by an emulated Internet: each ISP’s router, two backbone routers (198.51.100.1 and 198.51.100.2) and the destination servers. Each hop decrements the TTL by 1 and replies “time exceeded”, so traceroute and tracert show the path.'),
        table(['Server', 'Address', 'Use'], [
          ['dns.google', '8.8.8.8 · 8.8.4.4', 'Public recursive DNS (UDP 53). It also answers ping.'],
          ['www.google.com', '142.250.184.4', 'Test website: shows your public IP.'],
          ['example.com', '93.184.215.14', 'Test website.'],
          ['ifconfig.me', '34.160.111.145', 'Returns only your public IP as text (curl ifconfig.me).'],
        ]),
        h('Public names'),
        p('It also knows about 120 public names: the ones above, google.es, educa.jcyl.es, juandecolonia.es and the world’s 100 most visited domains (Similarweb and Semrush, 2026), without adult or gambling sites. Each has its www, resolves through 8.8.8.8 and by iteration from the root, and its address answers ping and HTTP. The addresses are representative of the real ones: big sites answer from many addresses that change.'),
        p('The DNS server of a Server or a Linux router can offer the same list with no Internet access: Services → DNS → Public names.'),
        h('Domains registered with an ISP'),
        p('In a cloud’s ISP tab you can register domains. The public DNS servers resolve them for every cloud:'),
        table(['Type', 'Answer from 8.8.8.8'], [
          ['A', 'The domain and any name under it (*.domain) point to the given IP.'],
          ['NS (delegation)', '8.8.8.8 queries the DNS server at that IP and forwards its answer: your Server is authoritative for the zone.'],
        ]),
        h('Example: publishing a branch office’s website'),
        code('Cloud ISP-Sur → Lines → DSL0 (operator router, WAN 81.33.3.2)\n  Forward TCP 80 → 192.168.1.10:80 and UDP 53 → 192.168.1.10:53\nCloud ISP-Sur → ISP → domain sede2.es, type NS, IP 81.33.3.2\nSRV-SEDE2 (192.168.1.10) → DNS: zone sede2.es with www → 81.33.3.2\nPC at another branch:  host www.sede2.es  ·  browser http://www.sede2.es'),
        note('The “Internet: two branch offices and public DNS” lab comes with all of this already set up.'),
        p('In simulation mode, packets crossing the Internet appear as events between the clouds (“Internet” port).'),
      ],
    },
    {
      id: 'ios-nat',
      title: 'NAT and standard ACLs (IOS)',
      summary: 'ip nat inside/outside, PAT with overload, pools, static NAT with ports and standard access lists.',
      blocks: [
        code('R1(config)# interface g0/0\nR1(config-if)# ip nat inside\nR1(config-if)# interface g0/1\nR1(config-if)# ip address dhcp\nR1(config-if)# ip nat outside\nR1(config-if)# exit\nR1(config)# access-list 1 permit 192.168.10.0 0.0.0.255\nR1(config)# ip nat inside source list 1 interface GigabitEthernet0/1 overload'),
        table(['Command', 'Use'], [
          ['ip nat inside | outside', 'Marks the interface (subinterfaces too).'],
          ['access-list N permit|deny any | host A | A WILDCARD', 'Numbered standard ACL (1-99). remark for comments.'],
          ['ip access-list standard NOMBRE', 'Named standard ACL: (config-std-nacl)# [sequence] permit|deny …'],
          ['ip nat pool NOMBRE INICIO FIN netmask M | prefix-length N', 'Range of global addresses.'],
          ['ip nat inside source list ACL interface IF overload', 'PAT: all permitted addresses go out with the interface’s IP.'],
          ['ip nat inside source list ACL pool NOMBRE [overload]', 'Dynamic 1:1 NAT (or PAT over the pool).'],
          ['ip nat inside source static LOCAL GLOBAL', 'Static 1:1 NAT (the router answers ARP for GLOBAL).'],
          ['ip nat inside source static tcp|udp LOCAL P GLOBAL|interface IF P', 'Publishes a port of an internal server.'],
        ]),
        h('Verification'),
        table(['Command', 'Shows'], [
          ['show ip nat translations', 'Pro, Inside global, Inside local, Outside local, Outside global.'],
          ['show ip nat statistics', 'Active translations, interfaces, hits/misses and dynamic rules with their pools.'],
          ['show access-lists', 'Entries of each list and matches.'],
          ['clear ip nat translation *', 'Clears the dynamic translations.'],
          ['debug ip nat', 'NAT: s=192.168.10.10->81.32.5.2, d=8.8.8.8 [n] for every translated packet.'],
        ]),
        note('Packets that match no rule go out untranslated (as in IOS): without NAT, the far end does not know how to get back to a private network.'),
      ],
    },
    {
      id: 'ios-web',
      title: 'Web management of routers and switches',
      summary: 'ip http server, port, enable or local authentication, users and pages of the IOS HTTP server.',
      blocks: [
        p('2911 routers and 2960 switches (on an SVI, interface Vlan1) have the IOS HTTP server. It is enabled in the CLI or in the “Web management” tab of their window (checkbox, port and users).'),
        code('Router(config)# ip http server\nRouter(config)# ip http port 8080\nRouter(config)# ip http authentication local\nRouter(config)# username admin privilege 15 secret netfix'),
        table(['Command', 'Use'], [
          ['ip http server', 'Listens on port 80 (or the one set with ip http port).'],
          ['ip http port N', 'Changes the port (1-65535).'],
          ['ip http authentication enable', 'Default: any user with the enable secret/password. Without an enable secret nobody gets in.'],
          ['ip http authentication local', 'username users; their privilege sets the level (15 = everything).'],
          ['username U [privilege N] secret|password CLAVE', 'Local user (secret is stored as a type 5 hash).'],
        ]),
        h('Pages'),
        table(['URL', 'Content'], [
          ['/', 'Home: “Accessing Cisco … "R1"” with links.'],
          ['/level/15/exec/-/show/ip/interface/brief/CR', 'Runs an EXEC command (words separated by /, CR at the end).'],
          ['/level/N/exec/-', 'Monitor: possible keywords as links and a Command box (level 1 = user EXEC).'],
          ['/level/15/configure/-', 'Configure: configuration commands, one per line.'],
          ['/level/15/dm', 'Device Manager: front panel, interface table and quick port settings (description, status, access VLAN, IP).'],
        ]),
        note('Authentication is HTTP Basic (realm level_15_access). Failures are logged as %SEC_LOGIN-4-LOGIN_FAILED and changes as %SYS-5-CONFIG_I … on vty0 (PC’s IP). curl -u user:password also works.'),
      ],
    },
    {
      id: 'red-broadcast',
      title: 'Broadcast: to every device of the network',
      summary: 'Link and IP broadcast (255.255.255.255 and directed), who answers a broadcast ping and who forwards it.',
      blocks: [
        p('A broadcast reaches every device of the segment: the switch floods it out of every port of its VLAN and no router passes it to another network. ARP and DHCP use it (MAC ff:ff:ff:ff:ff:ff) and it can be tried at the IP level with ping.'),
        table(['Destination', 'What it is', 'Reaches'], [
          ['255.255.255.255', 'Limited broadcast', 'The sender’s local network; no router forwards it.'],
          ['192.168.1.255 (on a /24)', 'Directed broadcast of the subnet', 'That subnet. From another network the router answers itself and only forwards it when enabled (below).'],
        ]),
        table(['Device', 'Does it answer a broadcast ping?', 'How to change it'], [
          ['Cisco router and switch', 'Yes, with its own address', '—'],
          ['GNU/Linux (Server, Linux router, PC in Linux mode)', 'No (Ubuntu: net.ipv4.icmp_echo_ignore_broadcasts = 1)', 'sudo sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0'],
          ['Windows (PC by default)', 'No', '—'],
        ]),
        code('$ ping 192.168.1.255\nping: Do you want to ping broadcast? Then -b. If not, check your local firewall rules\n$ ping -b -c 2 192.168.1.255\nWARNING: pinging broadcast address\nPING 192.168.1.255 (192.168.1.255) 56(84) bytes of data.\n64 bytes from 192.168.1.1: icmp_seq=1 ttl=255 time=0.400 ms\n64 bytes from 192.168.1.20: icmp_seq=1 ttl=64 time=0.400 ms (DUP!)\n…\n2 packets transmitted, 2 received, +2 duplicates, 0% packet loss\n\nRouter# ping 192.168.1.255\nReply to request 0 from 192.168.1.20, 1 ms'),
        h('Directed broadcast forwarding'),
        p('Off by default, because it allows amplification attacks (smurf). On a Cisco router it is enabled on the outgoing interface with ip directed-broadcast (no ip directed-broadcast is the norm since IOS 12.0); on the Linux router, with sudo sysctl -w net.ipv4.conf.all.bc_forwarding=1 and forwarding on.'),
        note('In simulation mode there is one frame to ff:ff:ff:ff:ff:ff that the switch copies to every port, then one reply per device that answers.'),
      ],
    },
    {
      id: 'inet-trace',
      title: 'traceroute and tracert',
      summary: 'Hop-by-hop path on GNU/Linux, Windows and IOS.',
      blocks: [
        table(['Device', 'Command', 'Options'], [
          ['GNU/Linux', 'traceroute DESTINO', '-n (no names), -m HOPS (30 by default)'],
          ['Windows', 'tracert DESTINO', '-h HOPS, -d'],
          ['Cisco router', 'traceroute A.B.C.D', '—'],
        ]),
        p('All three send ICMP echo with TTL 1, 2, 3… (like traceroute -I): each router along the path replies “time exceeded” and the destination answers the echo. Hops that do not reply appear as *.'),
        code('$ traceroute -n 8.8.8.8\ntraceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets\n 1  192.168.1.1  2.400 ms  2.211 ms  2.292 ms\n 2  81.32.0.1  6.319 ms  6.400 ms  6.211 ms\n 3  198.51.100.1  …'),
      ],
    },
  ],
};
