/** Documentation: Linux router (parameters, nftables and WireGuard), in guided style. */
import type { DocGroup } from '../types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const SECURITY_DOCS: DocGroup = {
  id: 'seguridad',
  title: 'Linux router',
  pages: [
    {
      id: 'linux-router',
      title: 'Linux router',
      summary: 'An Ubuntu box with three ports that routes: interfaces, ip_forward, routes, NAT and where each thing is configured.',
      markdownBase: MD,
      blocks: [
        p('The **Linux router** has a 2911’s ports (GigabitEthernet0/0-2) and the software of a Server with Ubuntu: in the terminal the ports are called **eth0**, **eth1** and **eth2**. It is like building a router from a PC with three network cards: it routes, does NAT and filters with **nftables**, and can join sites with **WireGuard**.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'isp', kind: 'cloud', label: 'ISP-Norte', x: 40, y: 0 },
            { id: 'fw', kind: 'linuxrouter', label: 'FW', x: 40, y: 20, note: 'eth0 81.32.5.2' },
            { id: 'lan', kind: 'switch', label: 'Switch0', x: 10, y: 40, note: 'eth1 · LAN 192.168.1.0/24' },
            { id: 'dmz', kind: 'server', label: 'WEB-DMZ', x: 75, y: 40, note: 'eth2 · DMZ 172.16.0.80' },
          ],
          links: [{ a: 'isp', b: 'fw' }, { a: 'fw', b: 'lan', label: 'eth1' }, { a: 'fw', b: 'dmz', label: 'eth2' }],
        }, 'The «Linux router with NAT and a DMZ (nftables)» lab: the Internet on eth0, the LAN on eth1 and the DMZ with the web server on eth2.'),
        h('Step by step: make it route'),
        steps(
          ['Interface addresses', '**Interfaces** tab (or `ip addr add 192.168.1.1/24 dev eth1`). eth0 can get its own from the operator by DHCP.'],
          ['Turn forwarding on', '**Services → Parameters**: `net.ipv4.ip_forward` = 1 and **Apply and save**. Without it, the router answers ping on its own IP addresses but drops everything that goes from one interface to another.'],
          ['Routes', 'Connected networks are added by themselves; the others with `ip route add NETWORK via NEXT-HOP` or in the Interfaces tab.'],
          ['Outbound NAT', '**Services → Firewall → Template** “Router with outbound NAT on eth0”, or an `oifname "eth0" masquerade` rule (see nftables).'],
        ),
        term('shell', 'root@fw:~# ip -br addr\nlo               UNKNOWN        127.0.0.1/8\neth0             UP             81.32.5.2/29\neth1             UP             192.168.1.1/24\neth2             UP             172.16.0.1/24\nroot@fw:~# sysctl net.ipv4.ip_forward\nnet.ipv4.ip_forward = 1\nroot@fw:~# ip route\ndefault via 81.32.5.1 dev eth0 proto dhcp metric 100\n81.32.5.0/29 dev eth0 proto kernel scope link src 81.32.5.2\n172.16.0.0/24 dev eth2 proto kernel scope link src 172.16.0.1\n192.168.1.0/24 dev eth1 proto kernel scope link src 192.168.1.1'),
        note('The **Enable router** box in Services → Parameters only reflects net.ipv4.ip_forward (ticked when it is 1); it is changed in the table or with sysctl. In web management (Security → Routing) the same box can be ticked: saving changes ip_forward and stores it in /etc/sysctl.d/99-netfix.conf.'),
        table(['Where', 'What is configured'], [
          ['Interfaces tab', 'IP address of each eth, DHCP on eth0, static routes and forwarding.'],
          ['Services → Parameters', 'Kernel parameters (sysctl: net.ipv4.ip_forward…); applied and saved.'],
          ['Services → Firewall', 'nftables: tables, chains, rules and templates.'],
          ['Services → VPN', 'The WireGuard wg0 tunnel.'],
          ['Web management (Security)', 'Routing, Firewall and VPN in the browser.'],
          ['Terminal', 'ip, sysctl, nft, wg, wg-quick, systemctl, journalctl, dmesg, nc, nmap.'],
        ]),
        tip('Its services are the Server’s', 'After Parameters, Firewall and VPN, the Services menu goes on with SSH, DHCP, DNS, HTTP, Email, Configuration and Logs, the same as on a Server: see their pages in the Server group.'),
        warn('Common mistakes', 'Forgetting ip_forward: the PCs reach the router but no further. Running `sysctl -w` or `ip route add` without saving it: it is lost on restart (save it in /etc/sysctl.d, in /etc/nftables.conf or with the panels, which apply and save). Without outbound NAT, the Internet does not know how to get back to the private LAN.'),
        exercise('Turn its forwarding off', 'In the «Linux router with NAT and a DMZ (nftables)» lab, check that PC0 can ping 8.8.8.8. Then set net.ipv4.ip_forward to 0 on FW and try again.', 'With forwarding on, `ping -c 1 8.8.8.8` answers. After `sysctl -w net.ipv4.ip_forward=0` on FW (or 0 in Services → Parameters), the same ping ends in “1 packets transmitted, 0 received, 100% packet loss”: FW no longer passes packets from eth1 to eth0. Set it back to 1.'),
      ],
    },
    {
      id: 'linux-nftables',
      title: 'nftables firewall',
      summary: 'Tables, chains with hooks, rules with ct state, NAT (masquerade, dnat), log and how to check it.',
      markdownBase: MD,
      blocks: [
        p('**nftables** is Linux’s firewall. Rules live in **chains** hung on a **hook**: **input** (what goes to the device itself), **forward** (what passes through it), **output** (what it generates) and **prerouting/postrouting** (NAT). Each chain has a default **policy** (accept or drop). **conntrack** remembers connections: `ct state established,related accept` lets the replies through without opening anything else.'),
        figure({
          type: 'sequence',
          actors: ['CLIENTE-EXT', 'FW (nftables)', 'WEB-DMZ'],
          messages: [
            { from: 0, to: 1, text: 'TCP 80 → 81.32.5.2', note: 'prerouting: dnat to 172.16.0.80' },
            { from: 1, to: 2, text: 'TCP 80 → 172.16.0.80', note: 'forward: “web publicada” accept' },
            { from: 2, to: 1, text: '200 OK' },
            { from: 1, to: 0, text: '200 OK', note: 'forward: ct state established' },
          ],
        }, 'The DMZ website published on FW’s public IP address: DNAT in prerouting, filtering in forward and conntrack for the way back.'),
        h('Step by step: a firewall with a DMZ'),
        steps(
          ['Start closed', 'input and forward chains with `policy drop`: whatever is not permitted is dropped.'],
          ['Let the replies through', '`ct state established,related accept` first, and `iifname "lo" accept` in input.'],
          ['Open what is needed', 'One rule per need, with a comment: management only from the LAN, the LAN to everywhere, the DMZ only to the Internet, the published website.'],
          ['NAT', '`dnat to 172.16.0.80` in prerouting to publish the website; `oifname "eth0" masquerade` in postrouting to go out.'],
          ['Log what is dropped', '`log prefix "FW-DROP " drop` at the end of forward: every dropped packet shows up in `dmesg`.'],
          ['Load and save', '**Apply and save** in the panel, or the /etc/nftables.conf file with `nft -f` and `systemctl enable --now nftables`.'],
        ),
        term('nftables', 'table inet filter {\n  chain input {\n    type filter hook input priority filter; policy drop;\n    ct state established,related accept\n    iifname "lo" accept\n    iifname "eth1" tcp dport { 22, 10000 } accept comment "administracion solo desde la LAN"\n    icmp type echo-request accept\n  }\n  chain forward {\n    type filter hook forward priority filter; policy drop;\n    ct state established,related accept\n    iifname "eth1" accept comment "LAN a todas partes"\n    iifname "eth2" oifname "eth0" accept comment "DMZ solo a Internet"\n    iifname "eth0" oifname "eth2" ip daddr 172.16.0.80 tcp dport 80 accept comment "web publicada"\n    log prefix "FW-DROP " drop\n  }\n}\ntable ip nat {\n  chain prerouting {\n    type nat hook prerouting priority dstnat; policy accept;\n    iifname "eth0" tcp dport 80 dnat to 172.16.0.80\n  }\n  chain postrouting {\n    type nat hook postrouting priority srcnat; policy accept;\n    oifname "eth0" masquerade\n  }\n}'),
        check('Check it', 'From outside, the website answers on the public IP address. From the DMZ towards the LAN nothing gets through, and `dmesg` on FW tells you so.'),
        term('shell', 'alumno@cliente-ext:~$ curl -s http://81.32.5.2/ | head -1\n<!doctype html>\nadmin@web-dmz:~$ ping -c 1 -W 1 192.168.1.10\nPING 192.168.1.10 (192.168.1.10) 56(84) bytes of data.\n\n--- 192.168.1.10 ping statistics ---\n1 packets transmitted, 0 received, 100% packet loss, time 0ms\nroot@fw:~# dmesg | tail -1\n[35895.957000] FW-DROP IN=eth2 OUT=eth1 MAC=00:ca:c2:10:00:f4:00:2d:9f:20:d0:fe:08:00 SRC=172.16.0.80 DST=192.168.1.10 LEN=84 TOS=0x00 PREC=0x00 TTL=63 ID=37967 DF PROTO=ICMP TYPE=8 CODE=0 ID=1 SEQ=1'),
        table(['Command', 'Effect'], [
          ['nft list ruleset', 'Running rules (with -a, the handles).'],
          ['nft add rule inet filter input tcp dport 80 accept', 'Adds a rule at the end; behind a “log … drop” it would never be reached (insert: at the start).'],
          ['nft delete rule inet filter input handle 7', 'Deletes a rule by its handle.'],
          ['nft -f /etc/nftables.conf · nft -c -f …', 'Loads a file atomically / only checks it.'],
          ['systemctl enable --now nftables', 'Loads /etc/nftables.conf at boot.'],
          ['dmesg', 'Lines from the rules with log prefix.'],
          ['nc -zv HOST PORT · nmap -p 22,80 HOST', 'Tests a port: “succeeded”, “Connection refused” (reject) or “timed out” (drop).'],
        ]),
        list(
          'The panel templates (hardened server, router with NAT, everything allowed) replace all the rules.',
          'Web management will not save a change that would lock you out of it.',
        ),
        warn('Common mistakes', 'Setting policy drop without `ct state established,related accept`: no reply comes back. Adding a rule with `add` after a final `drop`: it is never reached (use `insert` or place it before). Filtering in input what passes through the router: transit goes through forward. Testing from the router itself: its traffic goes through output, not forward.'),
        exercise('Can the DMZ get into the LAN?', 'In the «Linux router with NAT and a DMZ (nftables)» lab, ping 192.168.1.10 from WEB-DMZ and explain which rule decides it. Then check that the website can be seen from CLIENTE-EXT.', 'The ping gets no reply: in forward no rule permits eth2 → eth1 (“DMZ solo a Internet” only allows eth2 → eth0), so it reaches `log prefix "FW-DROP " drop` and `dmesg` on FW shows “FW-DROP IN=eth2 OUT=eth1 SRC=172.16.0.80 DST=192.168.1.10”. `curl http://81.32.5.2/` on CLIENTE-EXT returns WEB-DMZ’s page thanks to the dnat and the “web publicada” rule.'),
      ],
    },
    {
      id: 'linux-wireguard',
      title: 'WireGuard VPN',
      summary: 'Joining two sites with WireGuard step by step: keys, wg0.conf, AllowedIPs, Endpoint and PersistentKeepalive behind NAT.',
      markdownBase: MD,
      blocks: [
        p('**WireGuard** joins two Linux routers with a UDP tunnel (port 51820). Each end has a **private key** and knows the other’s **public** one (X25519, the same keys as the real wg). **AllowedIPs** says which networks arrive through each peer, and they become routes through wg0.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'pc0', kind: 'pc', label: 'PC0', x: 0, y: 0, note: '10.1.0.10' },
            { id: 'c', kind: 'linuxrouter', label: 'CENTRAL', x: 30, y: 0, note: 'wg0 10.99.0.1' },
            { id: 's', kind: 'linuxrouter', label: 'SUCURSAL', x: 65, y: 0, note: 'wg0 10.99.0.2' },
            { id: 'pc2', kind: 'pc', label: 'PC2', x: 95, y: 0, note: '10.2.0.10' },
          ],
          links: [{ a: 'pc0', b: 'c' }, { a: 'c', b: 's', label: 'UDP 51820 · wg0' }, { a: 's', b: 'pc2' }],
        }, 'The «WireGuard VPN: hub and branch behind NAT» lab: the hub has the public IP address 81.32.5.2; the branch, behind its operator’s NAT, calls it and keeps the NAT open with keepalive.'),
        h('Step by step'),
        steps(
          ['Generate the keys', 'On each router, **Services → VPN → Generate keys**, or `wg genkey | tee private.key | wg pubkey`. Give the public key to the other end.'],
          ['The interface', 'Tunnel address (10.99.0.1/24 on the hub, .2 on the branch), port 51820 and the private key.'],
          ['The peer', 'The other one’s public key and its **AllowedIPs**: its tunnel address and its LAN (the hub: 10.99.0.2/32, 10.2.0.0/24).'],
          ['The side behind NAT calls', 'On the branch: **Endpoint** = the hub’s public IP address:51820 and **PersistentKeepalive** = 25.'],
          ['Start it', '**Save and apply**, or `systemctl enable --now wg-quick@wg0`. Open UDP 51820 in input and let wg0 through in forward.'],
        ),
        code('[Interface]\nAddress = 10.99.0.2/24\nListenPort = 51820\nPrivateKey = (the branch’s private key)\n\n[Peer]\nPublicKey = (the hub’s public key)\nAllowedIPs = 10.99.0.0/24, 10.1.0.0/24\nEndpoint = 81.32.5.2:51820\nPersistentKeepalive = 25'),
        check('Check it', '`wg show` must have a **latest handshake** and traffic both ways; a traceroute from one LAN to the other goes through the tunnel address.'),
        term('shell', 'root@central:~# wg show\ninterface: wg0\n  public key: (the hub’s public key)\n  private key: (hidden)\n  listening port: 51820\n\npeer: (the branch’s public key)\n  endpoint: 81.33.3.2:51820\n  allowed ips: 10.99.0.2/32, 10.2.0.0/24\n  latest handshake: 29 seconds ago\n  transfer: 212 B received, 92 B sent\nalumno@pc0:~$ traceroute -n 10.2.0.10\ntraceroute to 10.2.0.10 (10.2.0.10), 30 hops max, 60 byte packets\n 1  10.1.0.1  4.400 ms  4.211 ms  4.292 ms\n 2  10.99.0.2  28.319 ms  28.400 ms  28.211 ms\n 3  10.2.0.10  32.238 ms  32.319 ms  32.400 ms'),
        table(['Command', 'Effect'], [
          ['wg-quick up wg0 · down wg0', 'Brings the tunnel up or down from /etc/wireguard/wg0.conf.'],
          ['wg show · wg showconf wg0', 'State (handshake, bytes, endpoint) / configuration in use.'],
          ['wg set wg0 peer KEY allowed-ips … endpoint IP:PORT', 'Changes a peer on the fly.'],
          ['ip a · ip route', 'wg0 shows up as a POINTOPOINT interface with its “dev wg0” routes.'],
        ]),
        tip('Repeated messages', 'Like the real WireGuard, Netfix ignores a message captured and sent again: the handshake initiation carries a timestamp (TAI64N) that must be newer than the last one accepted from that peer, and each data packet a counter that cannot repeat.'),
        note('PostUp/PostDown in wg0.conf run with bash (%i is the interface), for example to add nft rules. Masquerade should only apply to traffic leaving through eth0, not wg0.'),
        warn('Common mistakes', 'A wrong public key: the handshake never completes and `wg show` shows no “latest handshake”. AllowedIPs without the other one’s LAN: the tunnel comes up but there is no route to it. Nobody with an Endpoint when both are behind NAT: neither can start. UDP 51820 closed in the hub’s firewall.'),
        exercise('Follow the tunnel', 'In the «WireGuard VPN: hub and branch behind NAT» lab, check from PC0 that it reaches PC2 and which way it goes. From which public IP address does the branch call?', '`traceroute -n 10.2.0.10` on PC0: 10.1.0.1 (CENTRAL), 10.99.0.2 (the branch through the tunnel) and 10.2.0.10. On CENTRAL, `wg show` shows the peer with endpoint 81.33.3.2:51820: the public IP address of the branch’s operator router, learnt thanks to the keepalive.'),
      ],
    },
  ],
};
