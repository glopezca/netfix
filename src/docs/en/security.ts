/** Documentation: security and VPN (extended ACLs, IPsec, Linux router, nftables, WireGuard, SFTP). */
import type { DocGroup } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const SECURITY_DOCS: DocGroup = {
  id: 'seguridad',
  title: 'Security and VPN',
  pages: [
    {
      id: 'ios-acl',
      title: 'Extended ACLs',
      summary: 'access-list 100-199, ip access-list extended, ports, established, log and ip access-group in|out.',
      blocks: [
        p('An extended ACL filters by protocol, source, destination and ports. It is applied to an interface with ip access-group NAME in|out. Entries are checked in order and there is an implicit deny any at the end.'),
        code('Router(config)# ip access-list extended A-SERVIDORES\nRouter(config-ext-nacl)# permit tcp any host 172.20.0.10 eq www\nRouter(config-ext-nacl)# permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\nRouter(config-ext-nacl)# permit icmp 192.168.10.0 0.0.0.255 any\nRouter(config-ext-nacl)# deny ip any any log\nRouter(config-ext-nacl)# exit\nRouter(config)# interface g0/2\nRouter(config-if)# ip access-group A-SERVIDORES out'),
        table(['Element', 'Examples'], [
          ['Protocol', 'ip, tcp, udp, icmp, esp, gre'],
          ['Source / destination', 'any · host 10.0.0.2 · 192.168.10.0 0.0.0.255 (wildcard)'],
          ['Ports (tcp/udp)', 'eq www · eq 22 · gt 1023 · lt 1024 · neq 23 · range 50 60'],
          ['ICMP', 'echo · echo-reply · unreachable · time-exceeded'],
          ['Options', 'established (TCP with ACK or RST) · log (%SEC-6-IPACCESSLOGP)'],
        ]),
        list(
          'in filters what enters through the interface before NAT and routing; out filters transit traffic on its way out.',
          'An extended ACL also works for NAT: deny ip LAN1 LAN2 leaves that traffic untranslated (exemption for a VPN).',
          'show access-lists shows each entry with its “(N match(es))”; clear access-list counters resets them to zero.',
          'In named ACLs, “15 permit …” inserts with a sequence number and “no 15” deletes that entry.',
        ),
      ],
    },
    {
      id: 'ios-ipsec',
      title: 'IPsec VPN on the 2911',
      summary: 'crypto isakmp policy, crypto isakmp key, transform-set, crypto map, show crypto isakmp sa / ipsec sa.',
      blocks: [
        p('A site-to-site IPsec tunnel encrypts traffic between two LANs across the Internet. IKE (UDP 500) negotiates the policy and checks the pre-shared key without sending it; ESP then carries the packets. The first “interesting” packet is lost while the tunnel comes up.'),
        code('crypto isakmp policy 10\n encryption aes 256\n hash sha\n authentication pre-share\n group 5\ncrypto isakmp key Netfix-VPN-2026 address 203.0.113.2\ncrypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac\nip access-list extended VPN\n permit ip 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255\ncrypto map VPN 10 ipsec-isakmp\n set peer 203.0.113.2\n set transform-set TS-AES\n match address VPN\ninterface GigabitEthernet0/1\n crypto map VPN'),
        list(
          'Both sites need matching ISAKMP policies, the same key, matching transform-sets and mirror ACLs (source and destination swapped).',
          'With NAT overload on the same interface, exclude inter-site traffic from NAT with an extended ACL (deny ip LAN1 LAN2 before the permit).',
          'ESP has no ports: it gets through a 1:1 NAT but a PAT drops it. Use public IPs (the ISP cloud’s “Public IP” line).',
        ),
        table(['Command', 'What it shows'], [
          ['show crypto isakmp sa', 'The IKE SA: QM_IDLE when ready, MM_NO_STATE if it fails.'],
          ['show crypto ipsec sa', 'Protected identities, peers, SPI and the #pkts encaps/decaps and #send errors counters.'],
          ['show crypto map · show crypto isakmp policy', 'The configuration in use.'],
          ['clear crypto sa · clear crypto isakmp', 'Clears the SAs: the next packet negotiates again.'],
        ]),
        table(['Message', 'Cause'], [
          ['%CRYPTO-4-IKMP_BAD_MESSAGE', 'The pre-shared key does not match.'],
          ['%CRYPTO-6-IKMP_MODE_FAILURE … Main mode', 'No ISAKMP policy matches.'],
          ['%CRYPTO-6-IKMP_MODE_FAILURE … Quick mode', 'Transform-sets or mirror ACLs differ.'],
          ['%CRYPTO-4-RECVD_PKT_NOT_IPSEC', 'Traffic that the tunnel should protect arrives in clear.'],
        ]),
        note('The simulator does not encrypt the bytes: ESP carries the original packet, but the behaviour (negotiation, SPI, counters, errors) is that of IOS.'),
      ],
    },
    {
      id: 'linux-router',
      title: 'Linux Router',
      summary: '2911 hardware running Ubuntu: eth0-eth2, ip_forward, routes, NAT with nftables and web management.',
      blocks: [
        p('The Linux Router has the ports of a 2911 (GigabitEthernet0/0-2) and the Server software: in the terminal the ports are called eth0, eth1 and eth2. It only forwards packets between interfaces if net.ipv4.ip_forward = 1.'),
        code('root@linuxrouter0:~# ip addr add 192.168.1.1/24 dev eth1\nroot@linuxrouter0:~# ip route add 10.20.0.0/16 via 192.168.1.254\nroot@linuxrouter0:~# sysctl -w net.ipv4.ip_forward=1\nroot@linuxrouter0:~# echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-router.conf'),
        table(['Where', 'What is configured'], [
          ['Interfaces tab', 'Address of each eth, DHCP on eth0, static routes and forwarding.'],
          ['Services → Firewall and sysctl', 'nftables (tables, chains, rules, templates) and kernel parameters; applied and saved.'],
          ['Services → VPN', 'WireGuard tunnel wg0.'],
          ['Web management (Security)', 'The same options in WRT300N-style pages.'],
          ['Terminal', 'ip, sysctl, nft, wg, wg-quick, systemctl, journalctl, dmesg, nc, nmap.'],
        ]),
        note('What you do with ip, sysctl -w or nft changes the running state; to make it persist, save it in /etc/sysctl.d, /etc/nftables.conf or use the panels, which apply and save.'),
      ],
    },
    {
      id: 'linux-nftables',
      title: 'nftables firewall',
      summary: 'Tables, chains with hooks, rules with ct state, NAT (masquerade, dnat), log and nftables.service.',
      blocks: [
        p('nftables filters at the input (for the device), forward (in transit), output (generated by the device) and prerouting/postrouting (NAT) hooks. conntrack remembers connections, so “ct state established,related accept” lets replies through.'),
        code('table inet filter {\n  chain input {\n    type filter hook input priority filter; policy drop;\n    ct state established,related accept\n    iifname "lo" accept\n    tcp dport 22 ip saddr 192.168.10.0/24 accept\n    log prefix "NFT-DROP " drop\n  }\n}\ntable ip nat {\n  chain prerouting {\n    type nat hook prerouting priority dstnat; policy accept;\n    iifname "eth0" tcp dport 80 dnat to 172.16.0.80\n  }\n  chain postrouting {\n    type nat hook postrouting priority srcnat; policy accept;\n    oifname "eth0" masquerade\n  }\n}'),
        table(['Command', 'Effect'], [
          ['sudo nft list ruleset', 'Running rules (with -a, the handles).'],
          ['sudo nft add rule inet filter input tcp dport 80 accept', 'Appends a rule at the end (insert: at the beginning).'],
          ['sudo nft delete rule inet filter input handle 7', 'Deletes a rule by its handle.'],
          ['sudo nft -f /etc/nftables.conf · nft -c -f …', 'Loads a file atomically / only checks it.'],
          ['sudo systemctl enable --now nftables', 'Loads /etc/nftables.conf at boot.'],
          ['sudo dmesg', 'Lines from rules with log prefix.'],
        ]),
        list(
          'Testing the filtering: nc -zv HOST PORT (“succeeded”, “Connection refused” with reject or “timed out” with drop) and nmap -p 22,80 HOST.',
          'The panel’s templates (hardened server, router with NAT, allow everything) replace all the rules; web management prevents you from saving a change that would lock you out of it.',
        ),
      ],
    },
    {
      id: 'linux-wireguard',
      title: 'WireGuard VPN',
      summary: 'wg genkey/pubkey, /etc/wireguard/wg0.conf, wg-quick, AllowedIPs, endpoint, PersistentKeepalive.',
      blocks: [
        p('WireGuard joins two Linux routers with a UDP tunnel (port 51820). Each end has a private key and knows the other’s public key (X25519, the same keys as the real wg). AllowedIPs states which networks are reached through each peer, and they become routes via wg0.'),
        code('root@central:~# umask 077; wg genkey | tee /etc/wireguard/private.key | wg pubkey\nroot@central:~# cat /etc/wireguard/wg0.conf\n[Interface]\nAddress = 10.99.0.1/24\nListenPort = 51820\nPrivateKey = (the hub’s private key)\n\n[Peer]\nPublicKey = (the branch’s public key)\nAllowedIPs = 10.99.0.2/32, 10.2.0.0/24\nroot@central:~# systemctl enable --now wg-quick@wg0\nroot@central:~# wg show'),
        list(
          'The side behind NAT sets Endpoint = public_IP:51820 and PersistentKeepalive = 25: that opens the NAT and the hub learns its address (wg show wg0 endpoints).',
          'Open UDP 51820 in the input chain and let wg0 traffic through in forward; masquerade should only apply to traffic leaving via eth0.',
          'PostUp/PostDown in wg0.conf are run with bash (%i is the interface), for example to add nft rules.',
          'If a peer’s public key does not match, the handshake never completes: wg show shows no “latest handshake”.',
        ),
        table(['Command', 'Effect'], [
          ['wg-quick up wg0 · down wg0', 'Brings the tunnel up or down according to /etc/wireguard/wg0.conf.'],
          ['wg show · wg showconf wg0', 'Status (handshake, bytes, endpoint) / configuration in use.'],
          ['wg set wg0 peer CLAVE allowed-ips … endpoint IP:PUERTO', 'Changes a peer on the fly.'],
          ['ip a · ip route', 'wg0 appears as a POINTOPOINT interface, with its routes “dev wg0”.'],
        ]),
      ],
    },
    {
      id: 'srv-sftp',
      title: 'SFTP and scp',
      summary: 'sshd’s sftp subsystem, interactive and batch sftp, scp, and the PC’s SSH client and Files (SFTP) apps.',
      blocks: [
        p('sftp and scp use the same SSH connection (password or key pair) and the “Subsystem sftp …” subsystem in sshd_config. Every operation runs with the user’s permissions on the server: without write permission, “Permission denied”.'),
        code('alumno@pc0:~$ sftp ana@srv.aula.lab\nConnected to srv.aula.lab.\nsftp> put tarea.txt\nUploading tarea.txt to /home/ana/tarea.txt\nsftp> ls -l\nsftp> get bienvenida.txt\nsftp> bye\nalumno@pc0:~$ scp informe.txt ana@srv.aula.lab:entregas/\nalumno@pc0:~$ scp ana@srv.aula.lab:/etc/hostname .'),
        table(['sftp command', 'Effect'], [
          ['ls [-la] · cd · pwd', 'On the server.'],
          ['lls · lcd · lpwd · lmkdir', 'On the local device.'],
          ['get REMOTE [LOCAL] · put LOCAL [REMOTE]', 'Download / upload.'],
          ['mkdir · rmdir · rm · rename · chmod 640 FILE', 'Managing remote files.'],
          ['sftp -b batchfile user@host', 'Runs the commands in a file (implies BatchMode: a key pair is required).'],
        ]),
        h('PC apps'),
        list(
          'SSH client (like PuTTY): saved sessions, one terminal per session, key-pair generation and a list of known hosts with their fingerprints.',
          'Files (SFTP) (like FileZilla): quick connect, local and remote panes, upload, download, new folder, rename and delete; asks about the server’s fingerprint the first time.',
        ),
        note('If you remove the Subsystem line from sshd_config and reload ssh, sftp and scp fail with “subsystem request failed on channel 0”, but ssh keeps working.'),
      ],
    },
  ],
};
