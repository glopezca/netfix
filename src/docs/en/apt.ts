/** Documentation: installing services with apt and Netfix's Easter eggs, in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, h, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

const COW = '                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...';

export const APT_DOCS: readonly DocPage[] = [
  {
    id: 'linux-apt',
    title: 'Installing packages with apt',
    summary: 'Ubuntu 26.04 apt with a limited reach: real sources, a real network and a fictitious catalogue that turns on the server’s services, nmcli and mDNS.',
    markdownBase: MD,
    blocks: [
      p('A **Server** or a **GNU/Linux router** placed from the palette brings no service: only its IP configuration, the configuration files, the logs, the kernel parameters and its terminal. Each service is added with a box in its **Settings** tab or, as on a real Ubuntu, by installing its package with `apt`.'),
      p('apt reads the Ubuntu 26.04 (“resolute”) sources from **/etc/apt/sources.list.d/ubuntu.sources** (deb822 format) and really connects to archive.ubuntu.com and security.ubuntu.com over the simulated network. It only works if the device has a way out to the emulated Internet (an **ISP cloud** in the lab) and a DNS server that resolves those names (8.8.8.8, or yours forwarding to it).'),
      h('What each command does'),
      table(['Command', 'What it does in Netfix'], [
        ['sudo apt update', 'Checks each source (“Hit:”) and changes nothing: the catalogue is always up to date. Offline: “Ign:”, “Err:” and the real warnings.'],
        ['sudo apt upgrade · full-upgrade', 'Everything is at the latest version: “Upgrading: 0”.'],
        ['sudo apt autoremove', 'There is nothing to remove.'],
        ['sudo apt install PACKAGE', 'Downloads (simulated time passes), installs, ticks the service’s box and starts it. Asks “Continue? [Y/n]” unless -y.'],
        ['sudo apt remove · purge PACKAGE', 'Stops the service and removes its box and panel. Works offline.'],
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
      ]),
      h('Packages for any GNU/Linux device'),
      p('These can be installed in any GNU/Linux terminal, on a PC too, and are saved with the device:'),
      table(['Package', 'What it adds'], [
        ['network-manager', '`nmcli`: interface state, IP addresses, routes, DNS and connectivity (`nmcli`, `nmcli device show`, `nmcli connection show`, `nmcli general`). Before it is installed, bash suggests “sudo apt install network-manager”.'],
        ['avahi-daemon', 'mDNS: the device answers to its name followed by **.local** and can ask for the others (`ping pc1.local`, `ssh admin@srv.local`) without a DNS server. It brings libnss-mdns.'],
        ['libnss-mdns', 'Only asks for .local names; it does not answer for its own.'],
      ]),
      p('mDNS goes by multicast (224.0.0.251, UDP port 5353) to the devices on the same link: switches pass it on but routers do not, so it only works within the same network, and the other device needs avahi-daemon too. In Simulation mode you will see the MDNS packets; a firewall that blocks port 5353 stops it.'),
      p('**Windows** devices (PC or Windows Server) have mDNS built in, as Windows 10 and 11 do: with nothing installed they answer to their .local name and ask for the others (`ping pc1.local` in the Windows terminal). Windows asks from port 5353 and the answer comes by multicast; nss-mdns, from a port of its own with a direct answer.'),
      term('shell', 'alumno@pc1:~$ ping -c 1 pc0.local\nPING pc0.local (192.168.10.10) 56(84) bytes of data.\n64 bytes from pc0.local (192.168.10.10): icmp_seq=1 ttl=64 time=0.400 ms'),
      term('shell', 'root@srv:~# apt install -y apache2\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nInstalling:\n  apache2\n\nInstalling dependencies:\n  apache2-bin  apache2-data  apache2-utils  libapr1t64  libaprutil1t64  ssl-cert\n…\nSetting up apache2 (2.4.62-1ubuntu1) ...\nCreated symlink \'/etc/systemd/system/multi-user.target.wants/apache2.service\' → \'/usr/lib/systemd/system/apache2.service\'.'),
      steps(
        ['Place a server', 'From the palette, with a way out to the Internet (an ISP cloud or a router that reaches it) and 8.8.8.8 as DNS.'],
        ['Open its GNU/Linux terminal', '`sudo apt update` should give four “Hit:”.'],
        ['Install the service', '`sudo apt install apache2`: the Services tab appears at once with HTTP, and the HTTP box in Settings is ticked.'],
      ),
      check('Check it', 'From a PC, the browser opens the server’s website. `sudo apt remove apache2` stops Apache and removes the panel; the box is unticked too.'),
      warn('Offline', 'If the DNS does not answer you will see “Temporary failure resolving \'archive.ubuntu.com\'”; if the name does not exist, “Could not resolve”; if there is no route, “Could not connect … connection timed out”. Check the gateway and the DNS, as on a real server.'),
      tip('Limited reach', 'Only the packages of Netfix’s services, network-manager, avahi-daemon, libnss-mdns and those of the base system (which cannot be removed) are there. A name not in the catalogue gives “Unable to locate package”. Without sudo, apt gives dpkg’s real lock error.'),
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
