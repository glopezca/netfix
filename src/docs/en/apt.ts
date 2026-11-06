/** Documentation: installing services with apt and Netfix's Easter eggs, in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, h, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

const COW = '                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...';

export const APT_DOCS: readonly DocPage[] = [
  {
    id: 'linux-apt',
    title: 'Installing packages with apt',
    summary: 'Ubuntu 26.04 apt with a limited reach: real sources, a real network and a fictitious catalogue that turns on the server’s services, nmcli, mDNS and Samba.',
    markdownBase: MD,
    blocks: [
      p('A **Server** or a **GNU/Linux router** placed from the palette brings no service: only its IP configuration, the configuration files, the logs, the kernel parameters and its terminal. Each service (SSH, DHCP, DNS, HTTP, mail, firewall, VPN and also **Samba**, which GNU/Linux PCs have too) is added with its box in the **Settings** tab or, as on a real Ubuntu, by installing its package with `apt`. Both ways always agree: `apt install` ticks the box, adds its panel to **Services** and turns its page on in the **web management**; `apt remove` unticks it, takes the panel away and turns the page off (greyed, or hidden with the lab option), and ticking or unticking the box is the same as installing or removing the package.'),
      p('apt reads the Ubuntu 26.04 (“resolute”) sources from **/etc/apt/sources.list.d/ubuntu.sources** (deb822 format) and really connects to archive.ubuntu.com and security.ubuntu.com over the simulated network. It only works if the device has a way out to the emulated Internet (an **ISP cloud** in the lab) and a DNS server that resolves those names (8.8.8.8, or yours forwarding to it).'),
      h('What each command does'),
      table(['Command', 'What it does in Netfix'], [
        ['sudo apt update', 'Checks each source (“Hit:”) and changes nothing: the catalogue is always up to date. Offline: “Ign:”, “Err:” and the real warnings.'],
        ['sudo apt upgrade · full-upgrade', 'Everything is at the latest version: “Upgrading: 0”.'],
        ['sudo apt autoremove', 'Removes the dependencies apt installed on its own that no package needs any more (`apt list --installed` marks them “automatic”): after `apt remove samba`, for instance, samba-common-bin and with it `nmblookup`. If there are none: “Removing: 0”.'],
        ['sudo apt install PACKAGE', 'Downloads (simulated time passes), installs, ticks the service’s box and starts it. Asks “Continue? [Y/n]” unless -y.'],
        ['sudo apt remove · purge PACKAGE', 'Stops the service and removes its box and panel. Works offline. Its dependencies stay (“no longer required”) until `apt autoremove`.'],
        ['apt list [--installed]', 'The catalogue, or only what is installed (base and services); takes a pattern such as “dovecot*”.'],
      ]),
      table(['Package', 'Service it turns on'], [
        ['openssh-server (or ssh)', 'SSH'],
        ['kea-dhcp4-server (or kea)', 'DHCP'],
        ['bind9', 'DNS'],
        ['apache2', 'HTTP'],
        ['postfix · dovecot-imapd · dovecot-pop3d', 'Mail (SMTP, IMAP, POP3)'],
        ['nftables', 'Firewall (and, in the web management, Routing)'],
        ['wireguard (or wireguard-tools)', 'VPN (GNU/Linux router)'],
        ['rsyslog', 'Logs'],
        ['samba', 'Samba (servers, GNU/Linux routers and PCs). Settings → Current lab can take it away from each kind of device: then apt says “Unable to locate package samba”.'],
      ]),
      h('Packages for any GNU/Linux device'),
      p('These can be installed in any GNU/Linux terminal, on a PC too, and are saved with the device:'),
      table(['Package', 'What it adds'], [
        ['network-manager', '`nmcli`: interface state, IP addresses, routes, DNS and connectivity (`nmcli`, `nmcli device show`, `nmcli connection show`, `nmcli general`). Before it is installed, bash suggests “sudo apt install network-manager”.'],
        ['avahi-daemon', 'mDNS: the device answers to its name followed by **.local** and can ask for the others (`ping pc1.local`, `ssh admin@srv.local`) without a DNS server. It brings libnss-mdns.'],
        ['libnss-mdns', 'Only asks for .local names; it does not answer for its own.'],
        ['libnss-resolve', 'The NSS source `resolve`: ping, ssh and `getent` ask systemd-resolved and see the same as `resolvectl query`, LLMNR and mDNS included. Its installation puts `resolve [!UNAVAIL=return]` before dns in /etc/nsswitch.conf.'],
        ['nftables', 'The firewall (`nft`, /etc/nftables.conf). On a PC it adds the Firewall, Configuration and Logs panels to Services.'],
        ['smbclient', '`smbclient`: lists and opens the shared folders of another device (Windows or samba) from the terminal.'],
      ]),
      p('mDNS goes by multicast (224.0.0.251, UDP port 5353) to the devices on the same link: switches pass it on but routers do not, so it only works within the same network, and the other device needs avahi-daemon too. In Simulation mode you will see the MDNS packets; a firewall that blocks port 5353 stops it.'),
      p('**Windows** devices (PC or Windows Server) have mDNS built in, as Windows 10 and 11 do: with nothing installed they answer to their .local name and ask for the others (`ping pc1.local` in the Windows terminal). Windows asks from port 5353 and the answer comes by multicast; nss-mdns, from a port of its own with a direct answer.'),
      h('NetBIOS and shared folders: samba'),
      p('Windows has NetBIOS over TCP/IP built in: it answers to its name (NAME<00> and WORKGROUP, and NAME<20> when it shares files) and resolves a name without a dot by broadcast to its network (UDP 137) when the DNS does not know it; with **File and Printer Sharing for Microsoft Networks** ticked in its **Settings** tab, it also listens for SMB on TCP 139 and 445. A GNU/Linux device does the same with the **Samba** service (samba package: smbd and nmbd); `nmblookup NAME` (and `nmblookup -A IP`) asks NetBIOS from the terminal, and the device’s own name answers while nmbd is running (`localhost` is not a NetBIOS name, on Windows either).'),
      p('Samba is one more service, like DNS or DHCP, on servers, GNU/Linux routers and PCs too: smb.conf, the accounts (`smbpasswd`), the permissions, `net use` from Windows and `smbclient` from GNU/Linux are explained under **Server → Samba** (the pages “Samba: sharing folders” and “Samba: access from Windows and GNU/Linux”), and practised in the “Sharing folders with Samba on a GNU/Linux server” lab.'),
      p('For GNU/Linux programs (ping, ssh…) to resolve NetBIOS names, as on a real Ubuntu: `sudo apt install winbind libnss-winbind` and add **wins** to the `hosts:` line of **/etc/nsswitch.conf** (for instance `hosts: files dns wins`). Like mDNS, the NetBIOS broadcast does not cross routers; a WINS server does (`wins support = yes` on the server and `wins server = IP` on the clients; see “Name resolution”).'),
      p('For the same reason, from GNU/Linux mDNS always needs avahi-daemon or libnss-mdns: when installed, its script adds `mdns4_minimal [NOTFOUND=return]` to `hosts:` in /etc/nsswitch.conf, and removes it when they go.'),
      h('The Services tab of a GNU/Linux PC'),
      p('A PC has no web management (it has no HTTP server): what a server configures from the browser, a PC does in its terminal or in its **Services** tab. A GNU/Linux PC always shows the kernel **Parameters** (sysctl). `sudo apt install nftables` adds **Firewall**; `sudo apt install samba`, **Samba**; and either of them, **Configuration** (their files) and **Logs** (journalctl of nftables, smbd and nmbd). `sudo apt remove` takes them away at once. A Windows PC has no such tab.'),
      p('On a **Server** or a GNU/Linux router, installing samba adds the **Samba** panel to Services and the Samba page to the web management, and smbd and nmbd show up in Logs; removing it makes them go.'),
      term('shell', 'alumno@pc1:~$ ping -c 1 pc0.local\nPING pc0.local (192.168.10.10) 56(84) bytes of data.\n64 bytes from pc0.local (192.168.10.10): icmp_seq=1 ttl=64 time=0.400 ms'),
      term('shell', 'root@srv:~# apt install -y apache2\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nInstalling:\n  apache2\n\nInstalling dependencies:\n  apache2-bin  apache2-data  apache2-utils  libapr1t64  libaprutil1t64  ssl-cert\n…\nSetting up apache2 (2.4.62-1ubuntu1) ...\nCreated symlink \'/etc/systemd/system/multi-user.target.wants/apache2.service\' → \'/usr/lib/systemd/system/apache2.service\'.'),
      steps(
        ['Place a server', 'From the palette, with a way out to the Internet (an ISP cloud or a router that reaches it) and 8.8.8.8 as DNS.'],
        ['Open its GNU/Linux terminal', '`sudo apt update` should give four “Hit:”.'],
        ['Install the service', '`sudo apt install apache2`: the Services tab appears at once with HTTP, and the HTTP box in Settings is ticked.'],
      ),
      check('Check it', 'From a PC, the browser opens the server’s website. `sudo apt remove apache2` stops Apache and removes the panel; the box is unticked too.'),
      warn('Offline', 'If the DNS does not answer you will see “Temporary failure resolving \'archive.ubuntu.com\'”; if the name does not exist, “Could not resolve”; if there is no route, “Could not connect … connection timed out”. Check the gateway and the DNS, as on a real server.'),
      tip('Limited reach', 'Only the packages of Netfix’s services, network-manager, avahi-daemon, libnss-mdns, libnss-resolve, samba, smbclient, winbind, libnss-winbind and those of the base system (which cannot be removed) are there. A name not in the catalogue gives “Unable to locate package”. Without sudo, apt gives dpkg’s real lock error.'),
      exercise('A DNS server from scratch', 'Place a server in the “Internet: two sites and public DNS” lab, give it a way out and turn it into a DNS server using only the terminal.', 'Set the IP address, the gateway and DNS 8.8.8.8; then `sudo apt update` and `sudo apt install -y bind9`. The Services tab shows DNS and `systemctl status named` says it is active.'),
    ],
  },
  {
    id: 'huevos',
    title: 'Easter eggs',
    summary: 'Netfix’s hidden surprises, the same as in the real programs.',
    markdownBase: MD,
    blocks: [
      p('Like real programs, Netfix hides a few surprises. For now there are two.'),
      h('Midnight Commander’s credits'),
      p('In `mc`, **F2** or **F9** open the credits of Netfix and GNU Midnight Commander.'),
      h('apt’s super cow'),
      p('`apt moo` draws apt’s cow, just as on a real Ubuntu. Try `apt moo moo` and `apt moo moo moo` too. On some dates the phrase changes, and on 1 April the cow is another one (the simulation clock’s date counts).'),
      term('shell', `alumno@pc1:~$ apt moo\n${COW}`),
      tip('Are there more?', 'More may turn up one day. If you find one, you know where to look.'),
    ],
  },
];
