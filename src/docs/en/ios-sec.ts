/** Documentation: NAT, ACLs and IPsec on the IOS router, in guided style. */
import type { DocPage } from '../types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const IOS_SEC_DOCS: readonly DocPage[] = [
  {
    id: 'ios-nat',
    title: 'NAT and standard ACLs',
    summary: 'Going out to the Internet with a single public IP address: ip nat inside/outside, PAT with overload, static NAT and standard ACLs.',
    markdownBase: MD,
    blocks: [
      p('Private IP addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are not routed on the Internet. With **NAT** the router swaps the source IP address of every outgoing packet for its public one, and the destination of the reply for the PC’s. With **PAT** (overload) the whole network goes out with a single public IP address: the router tells each conversation apart by its port.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'pc1', kind: 'pc', label: 'PC1', x: 5, y: 0, note: '192.168.10.11' },
          { id: 'r', kind: 'router', label: 'SEDE1', x: 40, y: 0, note: 'inside .1 · outside 81.32.5.2' },
          { id: 'isp', kind: 'cloud', label: 'ISP-Norte', x: 80, y: 0 },
        ],
        links: [{ a: 'pc1', b: 'r', label: 'g0/0 inside' }, { a: 'r', b: 'isp', label: 'g0/1 outside' }],
      }, 'In the «Internet: two sites and public DNS» lab, everything leaving site 1’s LAN has 81.32.5.2 as its source.'),
      h('Step by step: PAT'),
      steps(
        ['Mark the inside', '`interface g0/0` and `ip nat inside`: the LAN.'],
        ['Mark the outside', '`interface g0/1` and `ip nat outside`: the ISP line (here with `ip address dhcp`).'],
        ['Say what is translated', 'A standard ACL with the inside network: `access-list 1 permit 192.168.10.0 0.0.0.255` (wildcard mask: the 0s must match).'],
        ['Turn the translation on', '`ip nat inside source list 1 interface GigabitEthernet0/1 overload`.'],
      ),
      code('SEDE1(config)# interface g0/0\nSEDE1(config-if)# ip nat inside\nSEDE1(config-if)# interface g0/1\nSEDE1(config-if)# ip address dhcp\nSEDE1(config-if)# ip nat outside\nSEDE1(config-if)# exit\nSEDE1(config)# access-list 1 permit 192.168.10.0 0.0.0.255\nSEDE1(config)# ip nat inside source list 1 interface GigabitEthernet0/1 overload'),
      check('Check it', 'After browsing from a PC, `show ip nat translations` shows one line per conversation: **Inside local** is the PC and **Inside global**, the public IP address with the port the router gave it.'),
      term('ios', 'SEDE1#show ip nat translations\nPro  Inside global         Inside local          Outside local         Outside global\nudp  81.32.5.2:50700       192.168.10.11:50700   8.8.8.8:53            8.8.8.8:53\ntcp  81.32.5.2:49152       192.168.10.11:49152   81.33.3.2:80          81.33.3.2:80\nicmp 81.32.5.2:1           192.168.10.11:1       8.8.8.8:1             8.8.8.8:1\nSEDE1#show ip nat statistics\nTotal active translations: 3 (0 static, 3 dynamic; 3 extended)\nOutside interfaces:\n  GigabitEthernet0/1\nInside interfaces:\n  GigabitEthernet0/0'),
      h('All the commands'),
      table(['Command', 'Use'], [
        ['ip nat inside | outside', 'Marks the interface (subinterfaces too).'],
        ['access-list N permit|deny any | host A | A WILDCARD', 'Numbered standard ACL (1-99). remark for comments.'],
        ['ip access-list standard NAME', 'Named standard ACL: (config-std-nacl)# [sequence] permit|deny …'],
        ['ip nat pool NAME START END netmask M | prefix-length N', 'Range of global IP addresses.'],
        ['ip nat inside source list ACL interface IF overload', 'PAT: every permitted address goes out with the interface’s IP address.'],
        ['ip nat inside source list ACL pool NAME [overload]', 'Dynamic 1:1 NAT (or PAT over the pool).'],
        ['ip nat inside source static LOCAL GLOBAL', 'Static 1:1 NAT (the router answers ARP for GLOBAL).'],
        ['ip nat inside source static tcp|udp LOCAL P GLOBAL|interface IF P', 'Publishes a port of an inside server.'],
        ['show ip nat translations · show ip nat statistics', 'Active translations and counters.'],
        ['clear ip nat translation * · debug ip nat', 'Clears the dynamic translations · one line per translated packet.'],
      ]),
      tip('Publishing a server', 'To reach a LAN server from the Internet: `ip nat inside source static tcp 192.168.10.5 80 interface GigabitEthernet0/1 80`. Requests to port 80 of the public IP address go to 192.168.10.5.'),
      warn('Common mistakes', 'Swapping inside and outside. An ACL that does not include the PCs’ network (or a wildcard written as a mask, 255.255.255.0): nothing is translated. Packets that do not match go out untranslated and the other end does not know how to get back to a private network.'),
      exercise('Which IP address does PC1 go out with?', 'In the «Internet: two sites and public DNS» lab, open http://www.sede2.es from PC1 and find out on SEDE1 with which IP address and port that connection went out.', '`show ip nat translations` on SEDE1: the tcp line with Outside 81.33.3.2:80 has Inside local 192.168.10.11:49152 and Inside global 81.32.5.2:49152. Site 2’s website only sees 81.32.5.2, the IP address the ISP gave g0/1 (`show ip interface brief`: method DHCP).'),
    ],
  },
  {
    id: 'ios-acl',
    title: 'Extended ACLs',
    summary: 'Filtering by protocol, source, destination and port: writing the list, applying it in the right direction and reading its counters.',
    markdownBase: MD,
    blocks: [
      p('An **extended ACL** decides which traffic goes through an interface by protocol, source, destination and ports. The entries are checked **in order** and the first match wins; at the end there is an **implicit deny any**: what is not permitted is dropped.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'admin', kind: 'pc', label: 'ADMIN', x: 0, y: 0, note: '192.168.10.10' },
          { id: 'alumno', kind: 'pc', label: 'ALUMNO', x: 80, y: 0, note: '192.168.20.10' },
          { id: 'gw', kind: 'router', label: 'GW', x: 40, y: 15 },
          { id: 'srv', kind: 'server', label: 'SRV-INTRANET', x: 40, y: 45, note: '172.20.0.10' },
        ],
        links: [{ a: 'admin', b: 'gw', label: 'g0/0' }, { a: 'alumno', b: 'gw', label: 'g0/1' }, { a: 'gw', b: 'srv', label: 'g0/2 · A-SERVIDORES out' }],
      }, 'The «Hardening: ACL, nftables and sshd» lab: the website is for everyone; SSH and ping, only from administration.'),
      h('Step by step'),
      steps(
        ['Write the rule in words', '“The server’s website, for everyone; SSH and ping, only from 192.168.10.0/24; nothing else”.'],
        ['Create the list', '`ip access-list extended A-SERVIDORES` and one entry per rule, from the most specific to the most general.'],
        ['Choose interface and direction', 'As close to the destination as possible: `interface g0/2` (the servers’ network) and `ip access-group A-SERVIDORES out`.'],
        ['Check', 'Test from each network and look at `show access-lists`: each entry counts its matches.'],
      ),
      code('GW(config)# ip access-list extended A-SERVIDORES\nGW(config-ext-nacl)# permit tcp any host 172.20.0.10 eq www\nGW(config-ext-nacl)# permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\nGW(config-ext-nacl)# permit icmp 192.168.10.0 0.0.0.255 any\nGW(config-ext-nacl)# permit udp any host 172.20.0.10 eq domain\nGW(config-ext-nacl)# deny ip any any log\nGW(config-ext-nacl)# exit\nGW(config)# interface g0/2\nGW(config-if)# ip access-group A-SERVIDORES out'),
      check('Check it', 'After trying the website, SSH and ping from ADMIN and ALUMNO, the counters say which entry decided each case. With `log`, every dropped packet leaves a notice on the router’s console.'),
      term('ios', 'GW#show access-lists\nExtended IP access list A-SERVIDORES\n    20 permit tcp any host 172.20.0.10 eq www (3 match(es))\n    30 permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\n    40 permit icmp 192.168.10.0 0.0.0.255 any (2 match(es))\n    50 permit udp any host 172.20.0.10 eq domain\n    60 deny ip any any log (2 match(es))\n%SEC-6-IPACCESSLOGP: list A-SERVIDORES denied tcp 192.168.20.10(49153) -> 172.20.0.10(22), 1 packet'),
      table(['Element', 'Examples'], [
        ['Protocol', 'ip, tcp, udp, icmp, esp, gre'],
        ['Source / destination', 'any · host 10.0.0.2 · 192.168.10.0 0.0.0.255 (wildcard)'],
        ['Ports (tcp/udp)', 'eq www · eq 22 · gt 1023 · lt 1024 · neq 23 · range 50 60'],
        ['ICMP', 'echo · echo-reply · unreachable · time-exceeded'],
        ['Options', 'established (TCP with ACK or RST) · log (%SEC-6-IPACCESSLOGP)'],
      ]),
      list(
        'in filters what comes in through the interface before NAT and routing; out filters what goes out in transit (neither the replies coming in through that interface nor the router’s own traffic).',
        'An extended ACL also serves NAT: deny ip LAN1 LAN2 leaves that traffic untranslated (an exemption for a VPN).',
        'clear access-list counters resets the counters.',
        'In named ACLs, “15 permit …” inserts with a sequence number and “no 15” deletes that entry.',
      ),
      warn('Common mistakes', 'Putting a general entry before a specific one: the specific one is never used. Forgetting the implicit deny: a list with only a deny blocks everything. Applying it in the wrong direction (in instead of out): it does not filter what you wanted, or it filters the replies. Permitting TCP 22 without thinking about the way back: with `out` on the server’s network, the replies do not go through that list.'),
      exercise('Why can ALUMNO not get in over SSH?', 'In the «Hardening: ACL, nftables and sshd» lab, `ssh admin@172.20.0.10` from ALUMNO answers at once “ssh: connect to host 172.20.0.10 port 22: No route to host”, but the website does open. Which entry decides it, and where does that message come from?', 'Entry 30 only permits SSH from 192.168.10.0/24; ALUMNO is 192.168.20.10, so it reaches entry 60 (`deny ip any any log`): GW’s console shows “%SEC-6-IPACCESSLOGP: list A-SERVIDORES denied tcp 192.168.20.10(…) -> 172.20.0.10(22)”. GW also answers with an ICMP “administratively prohibited”, and ALUMNO’s Linux aborts the connection: hence “No route to host” (a Windows client ignores it and ends in “Connection timed out”). The website goes through entry 20 (`permit tcp any … eq www`), which adds matches in `show access-lists`.'),
    ],
  },
  {
    id: 'ios-ipsec',
    title: 'IPsec VPN on the 2911',
    summary: 'A site-to-site tunnel step by step: ISAKMP policy, key, transform-set, mirror ACL and crypto map; and how to check it.',
    markdownBase: MD,
    blocks: [
      p('A **site-to-site IPsec VPN** joins two LANs across the Internet as if they were together, with the traffic encrypted. **IKE** (UDP 500) negotiates the policy and checks the shared key without sending it; then **ESP** carries the packets. The first “interesting” packets are lost while the tunnel comes up.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'a', kind: 'router', label: 'SEDE-A', x: 10, y: 20, note: '81.32.5.2 · LAN 192.168.10.0/24' },
          { id: 'inet', kind: 'cloud', label: 'Internet', x: 45, y: 0 },
          { id: 'b', kind: 'router', label: 'SEDE-B', x: 80, y: 20, note: '81.33.5.2 · LAN 192.168.20.0/24' },
        ],
        links: [{ a: 'a', b: 'inet' }, { a: 'inet', b: 'b' }, { a: 'a', b: 'b', label: 'ESP tunnel (logical)' }],
      }, 'The «IPsec VPN between two sites (2911)» lab: each site protects the traffic towards the other one’s LAN.'),
      h('Step by step (on both sites)'),
      steps(
        ['ISAKMP policy (phase 1)', '`crypto isakmp policy 10` with encryption, hash, authentication and DH group: `encryption aes 256`, `hash sha`, `authentication pre-share`, `group 5`.'],
        ['Shared key', '`crypto isakmp key Netfix-VPN-2026 address 81.33.5.2` (the other site’s public IP address).'],
        ['Transform-set (phase 2)', '`crypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac`.'],
        ['Interesting traffic', 'An extended ACL from your LAN to theirs. On the other site, the same reversed (mirror ACL).'],
        ['Crypto map', '`crypto map VPN 10 ipsec-isakmp` with `set peer`, `set transform-set` and `match address`, and apply it with `crypto map VPN` on the public interface.'],
      ),
      code('crypto isakmp policy 10\n encryption aes 256\n hash sha\n authentication pre-share\n group 5\ncrypto isakmp key Netfix-VPN-2026 address 81.33.5.2\ncrypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac\nip access-list extended VPN\n permit ip 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255\ncrypto map VPN 10 ipsec-isakmp\n set peer 81.33.5.2\n set transform-set TS-AES\n match address VPN\ninterface GigabitEthernet0/1\n crypto map VPN'),
      check('Check it', 'Ping from one LAN to the other: the first ones are lost while it negotiates. Then the IKE SA is in **QM_IDLE** and the encaps/decaps counters go up.'),
      term('cmd', 'C:\\home\\alumno> ping -n 4 192.168.20.10\nPinging 192.168.20.10 with 32 bytes of data:\nRequest timed out.\nRequest timed out.\nReply from 192.168.20.10: bytes=32 time<1ms TTL=126\nReply from 192.168.20.10: bytes=32 time<1ms TTL=126'),
      term('ios', 'SEDE-A#show crypto isakmp sa\nIPv4 Crypto ISAKMP SA\ndst             src             state          conn-id status\n81.33.5.2       81.32.5.2       QM_IDLE           1001 ACTIVE\nSEDE-A#show crypto ipsec sa | include encaps|decaps\n   #pkts encaps: 3, #pkts encrypt: 3, #pkts digest: 3\n   #pkts decaps: 2, #pkts decrypt: 2, #pkts verify: 2'),
      table(['Command', 'What it shows'], [
        ['show crypto isakmp sa', 'The IKE SA: QM_IDLE when it is ready, MM_NO_STATE if it fails.'],
        ['show crypto ipsec sa', 'Protected identities, peers, SPI and the #pkts encaps/decaps and #send errors counters.'],
        ['show crypto map · show crypto isakmp policy', 'The configuration in use.'],
        ['clear crypto sa · clear crypto isakmp', 'Clears the SAs: the next packet negotiates again.'],
      ]),
      table(['Message', 'Cause'], [
        ['%CRYPTO-4-IKMP_BAD_MESSAGE', 'The shared key does not match.'],
        ['%CRYPTO-6-IKMP_MODE_FAILURE … Main mode', 'No ISAKMP policy matches.'],
        ['%CRYPTO-6-IKMP_MODE_FAILURE … Quick mode', 'Different transform-set or mirror ACL.'],
        ['%CRYPTO-4-RECVD_PKT_NOT_IPSEC', 'Traffic the tunnel should protect arrives in clear.'],
      ]),
      warn('Common mistakes', 'Different keys, policies or transform-sets on each site. ACLs that are not mirrors. With NAT overload on the same interface, inter-site traffic is translated before being encrypted: exempt it from NAT with an extended ACL (deny ip LAN1 LAN2 before the permit). ESP has no ports: it crosses a 1:1 NAT but a PAT drops it; use public IP addresses (the ISP cloud’s “Public IP address” line).'),
      note('The simulator does not encrypt the bytes: ESP carries the original packet, but the behaviour (negotiation, SPI, counters, errors) is IOS’s.'),
      exercise('Bring the tunnel up', 'In the «IPsec VPN between two sites (2911)» lab, get PC0 (site A) to reach PC2 (site B) and check on SEDE-A that the tunnel is up.', 'In PC0’s Windows terminal: `ping -n 4 192.168.20.10`: two “Request timed out.” and two replies. On SEDE-A, `show crypto isakmp sa` shows 81.33.5.2 81.32.5.2 QM_IDLE ACTIVE, and `show crypto ipsec sa` counts the encapsulated and decapsulated packets.'),
    ],
  },
];
