/** Documentation: ISP cloud and emulated Internet (in guided style), broadcasts and traceroute. */
import type { DocGroup } from '../types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/glopezca/netfix/blob/main/';

export const INTERNET_DOCS: DocGroup = {
  id: 'internet',
  title: 'Internet and NAT',
  pages: [
    {
      id: 'inet-cloud',
      title: 'ISP cloud',
      summary: 'An operator’s way out to the Internet: cable, xDSL and fibre lines, operator-router or public-IP-address mode, and port forwarding.',
      markdownBase: MD,
      blocks: [
        p('The **Cloud** (palette → Cloud) is an **Internet service provider**: each of its six ports is a customer line, like the one reaching a home or a company. Coaxial0-1 (DOCSIS cable), DSL0-1 (VDSL2) and Fibra0-1 (FTTH). A router (GigabitEthernet), a switch or a PC is plugged into each line.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'norte', kind: 'cloud', label: 'ISP-Norte', x: 15, y: 0 },
            { id: 'sur', kind: 'cloud', label: 'ISP-Sur', x: 70, y: 0 },
            { id: 'sede1', kind: 'router', label: 'SEDE1', x: 15, y: 25, note: 'Fibra0 · public IP address' },
            { id: 'sw', kind: 'switch', label: 'Switch1', x: 70, y: 25, note: 'DSL0 · operator router' },
            { id: 'srv', kind: 'server', label: 'SRV-SEDE2', x: 85, y: 50, note: '192.168.1.10' },
          ],
          links: [{ a: 'norte', b: 'sur', label: 'Internet' }, { a: 'norte', b: 'sede1' }, { a: 'sur', b: 'sw' }, { a: 'sw', b: 'srv' }],
        }, 'The «Internet: two sites and public DNS» lab: site 1 has its own router with NAT; site 2 uses the operator’s router and asks it to forward the website.'),
        h('The two modes of a line'),
        table(['Line mode', 'What it does', 'When to use it'], [
          ['Operator router (default)', 'It is the home router: LAN 192.168.1.1/24, DHCP from .33 (DNS 8.8.8.8 and 8.8.4.4), NAT of the whole LAN to the public IP address x.y.n.2 and port forwarding.', 'Plugging in PCs, a switch or a server directly.'],
          ['Public IP address (/29)', 'The cloud is the gateway x.y.n.1/29 and hands x.y.n.2 to your router by DHCP; .3-.6 are free for static NAT.', 'Setting up NAT yourself on a Cisco 2911 or a Linux router.'],
        ]),
        h('Step by step: publishing a server behind the operator router'),
        steps(
          ['Plug in the line', 'A cable from DSL0 (for example) to the site’s switch; the devices get 192.168.1.x by DHCP.'],
          ['Fix the server’s IP address', 'The server needs a static LAN IP address (192.168.1.10) so the forwarding does not change.'],
          ['Forward the port', 'Double-click the cloud → **Lines** → DSL0 → **Port forwarding (NAT)**: TCP 80 → 192.168.1.10:80.'],
          ['Test it from outside', 'From another site, `curl http://81.33.3.2/` (the line’s public IP address) must return the website.'],
        ),
        check('Check it', '`curl ifconfig.me` tells you with which public IP address each device goes out to the Internet: all the devices of a line share that line’s address.'),
        term('shell', 'alumno@pc1:~$ curl -s ifconfig.me\n81.32.5.2\nadmin@srv-sede2:~$ curl -s ifconfig.me\n81.33.3.2\nalumno@pc1:~$ curl http://81.33.3.2:8080/\ncurl: (7) Failed to connect to 81.33.3.2 port 8080 after 0 ms: Couldn\'t connect to server'),
        h('Addresses'),
        list(
          'Each cloud has its own public /16 block (the first 81.32.0.0, the second 81.33.0.0…). Port number i (Coaxial0 = 1, Coaxial1 = 2, DSL0 = 3, DSL1 = 4, Fibra0 = 5, Fibra1 = 6) uses x.y.i.0/29.',
          'The ISP’s router on the backbone is x.y.0.1 and shows up in traceroute.',
          'Each line has its own IP plane: several lines can use 192.168.1.0/24 at the same time.',
        ),
        table(['Cloud tab', 'What it has'], [
          ['ISP', 'Provider name, public block and registered domains.'],
          ['Lines', 'Per line: mode, contracted speeds (informative), LAN IP address and mask, DHCP leases, NAT translations and port forwarding (TCP or UDP, public port → LAN IP address:port).'],
        ]),
        warn('Common mistakes', 'Without forwarding, only the router itself answers from the Internet (ping to the public IP address); any other port is refused and curl says “Couldn\'t connect to server”. Forwarding to a server with a DHCP IP address: if it changes, the forwarding points at another device. Plugging a router into an “Operator router” line: you get double NAT.'),
        exercise('Which IP address does each site go out with?', 'In the «Internet: two sites and public DNS» lab, find out with which public IP address PC1 (site 1) goes out and with which SRV-SEDE2 (site 2) does. Which line and mode does each have?', '`curl -s ifconfig.me`: PC1 goes out with 81.32.5.2 (ISP-Norte, Fibra0 = port 5, Public IP address mode: the one SEDE1 gets by DHCP on g0/1) and SRV-SEDE2 with 81.33.3.2 (ISP-Sur, DSL0 = port 3, Operator router mode: the cloud does the NAT).'),
      ],
    },
    {
      id: 'inet-dns',
      title: 'Emulated Internet and public DNS',
      summary: 'Backbone routers, 8.8.8.8, test websites, public names, registered domains and NS delegation to your own server.',
      markdownBase: MD,
      blocks: [
        p('All the clouds in the workspace are joined by an **emulated Internet**: each ISP’s router, two backbone routers (198.51.100.1 and 198.51.100.2) and the destination servers. Each hop takes 1 off the TTL and answers “time exceeded”, so traceroute and tracert show the path.'),
        term('shell', 'alumno@pc1:~$ traceroute -n 8.8.8.8\ntraceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets\n 1  192.168.10.1  4.400 ms  4.211 ms  4.292 ms\n 2  81.32.5.1  6.319 ms  6.400 ms  6.211 ms\n 3  81.32.0.1  10.238 ms  10.319 ms  10.400 ms\n 4  198.51.100.1  14.427 ms  14.238 ms  14.319 ms\n 5  198.51.100.2  14.346 ms  14.427 ms  14.238 ms\n 6  142.250.0.1  16.265 ms  16.346 ms  16.427 ms\n 7  8.8.8.8  26.454 ms  26.265 ms  26.346 ms'),
        table(['Hop', 'Who it is'], [
          ['1', 'The LAN gateway (SEDE1).'],
          ['2', 'The line’s router in the cloud (x.y.n.1).'],
          ['3', 'The ISP’s router on the backbone (x.y.0.1).'],
          ['4-5', 'The Internet backbone routers.'],
          ['6-7', 'The destination’s network and the destination.'],
        ]),
        table(['Server', 'IP address', 'Use'], [
          ['dns.google', '8.8.8.8 · 8.8.4.4', 'Public recursive DNS (UDP 53). It also answers ping.'],
          ['www.google.com', '142.250.184.4', 'Test website: shows your public IP address.'],
          ['example.com', '93.184.215.14', 'Test website.'],
          ['ifconfig.me', '34.160.111.145', 'Returns just your public IP address as text (curl ifconfig.me).'],
        ]),
        p('It also knows about 120 **public names**: the ones above, google.es, educa.jcyl.es, juandecolonia.es and the world’s 100 most visited domains (Similarweb and Semrush, 2026), without adult or gambling sites. Each has its www, resolves through 8.8.8.8 and by iteration from the root, and its IP address answers ping and HTTP. The IP addresses are representative of the real ones: big websites answer from many addresses that change.'),
        tip('Without a way out to the Internet', 'The DNS server of a Server or a Linux router can offer the same list offline: Services → DNS → Public names.'),
        h('Step by step: your domain on the Internet'),
        p('In a cloud’s **ISP** tab you can register domains, and the public DNS servers resolve them for every cloud. With an **NS** record (delegation), 8.8.8.8 asks your own server: you are the zone’s authority.'),
        steps(
          ['Publish your server’s DNS', 'On the site’s line, forward **UDP 53** (and TCP 80 for the website) to the server’s IP address.'],
          ['Create the zone', 'On the server, **Services → DNS**: zone sede2.es with www and srv pointing at the **public** IP address (81.33.3.2), the one outsiders will see.'],
          ['Register the domain', 'Cloud → **ISP** → **Registered domains**: sede2.es, type **NS**, IP address 81.33.3.2.'],
          ['Test it from another site', '`host www.sede2.es` and the browser with http://www.sede2.es.'],
        ),
        table(['Record type in the ISP', 'Answer from 8.8.8.8'], [
          ['A', 'The domain and any name under it (*.domain) point at the given IP address.'],
          ['NS (delegation)', '8.8.8.8 asks the DNS server at that IP address and passes on its answer.'],
        ]),
        check('Check it', 'From the other site, the name resolves with your zone’s data (the www → srv alias comes from your server) and the website opens.'),
        term('shell', 'alumno@pc1:~$ host www.sede2.es\nwww.sede2.es is an alias for srv.sede2.es.\nsrv.sede2.es has address 81.33.3.2\nalumno@pc1:~$ curl -sI http://www.sede2.es | head -1\nHTTP/1.1 200 OK'),
        warn('Common mistakes', 'Putting the server’s private IP address (192.168.1.10) in the zone: it cannot be reached from outside. Forgetting to forward UDP 53: 8.8.8.8 gets no answer and the name does not resolve. Registering the domain as type A when you wanted to manage the zone yourself.'),
        note('In simulation mode the packets crossing the Internet show up as events between the clouds (“Internet” port).'),
        exercise('Follow www.sede2.es', 'In the «Internet: two sites and public DNS» lab, who really answers when PC1 asks for www.sede2.es? Find the pieces in the ISP-Sur cloud and in SRV-SEDE2.', 'In ISP-Sur → ISP, sede2.es is registered as NS with 81.33.3.2; on line DSL0, forwarding takes TCP 80, TCP 22 and UDP 53 to 192.168.1.10. SRV-SEDE2 has the sede2.es zone (www CNAME srv, srv A 81.33.3.2). So `host www.sede2.es` on PC1 returns the alias from SRV-SEDE2’s zone, and SRV-SEDE2 also serves the website.'),
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
        p('As on Linux, the sender also gets its own copy of the broadcast: with icmp_echo_ignore_broadcasts=0 it answers itself (its address is in the list).'),
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
