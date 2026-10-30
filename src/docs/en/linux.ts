/** Documentation: the GNU/Linux terminal (overview, file system, programs and network), in guided style. */
import type { DocBlock, DocPage } from '../types.ts';
import { check, code, exercise, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';
import { UTIL_DOCS, UTIL_GROUPS } from './utils.ts';
import type { UtilDoc } from '../utils.ts';

function utilityBlocks(groups: readonly UtilDoc['group'][]): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const g of groups) {
    const names = Object.keys(UTIL_DOCS).filter((n) => UTIL_DOCS[n]?.group === g).sort();
    blocks.push(h(UTIL_GROUPS[g]), table(['Program', 'Usage', 'Description'], names.map((n) => [n, UTIL_DOCS[n]?.synopsis ?? '', UTIL_DOCS[n]?.summary ?? ''])));
    for (const n of names) {
      const o = UTIL_DOCS[n]?.options;
      if (o) blocks.push(p(`Options for ${n}:`), code(o));
    }
  }
  return blocks;
}

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const LINUX_DOCS: readonly DocPage[] = [
  {
    id: 'linux-intro',
    title: 'The GNU/Linux Terminal',
    summary: 'Ubuntu 26.04 with GNU bash 5.3 on every PC and server: your first session, your first script and what is available.',
    markdownBase: MD,
    blocks: [
      p('Every PC and every Server has its own simulated Ubuntu 26.04 system: a file system with permissions, user accounts, GNU bash 5.3.20 and the most widely used GNU utilities (coreutils, grep, sed, mawk, find…), plus the network programs that talk to the simulated network (ip, ping, dig, curl, ssh…).'),
      code('alumno@pc0:~$ echo "Hola" > saludo.txt && cat saludo.txt\nHola\nalumno@pc0:~$ for h in srv www; do dig +short $h.aula.lab; done\nalumno@pc0:~$ ip -br a\nalumno@pc0:~$ sudo dhclient -r eth0 && sudo dhclient eth0\nalumno@pc0:~$ ssh admin@srv.aula.lab'),
      h('Step by step: your first script'),
      steps(
        ['Open the terminal', 'Double-click a PC → **GNU/Linux terminal**. The prompt `alumno@pc1:~$` tells you user, device and directory (~ is your home).'],
        ['See where you are', '`pwd` and `ls -la` (with -a, the hidden files starting with a dot too).'],
        ['Write the script', '`nano saludo.sh` with two lines: `#!/bin/bash` and `echo "Hola, $USER, desde $(hostname)"`. Ctrl+O saves and Ctrl+X quits.'],
        ['Make it executable', '`chmod +x saludo.sh`; without it, `./saludo.sh` gives “Permission denied”.'],
        ['Run it', '`./saludo.sh`.'],
      ),
      term('shell', 'alumno@pc1:~$ cat saludo.sh\n#!/bin/bash\necho "Hola, $USER, desde $(hostname)"\nalumno@pc1:~$ ./saludo.sh\nbash: ./saludo.sh: Permission denied\nalumno@pc1:~$ chmod +x saludo.sh\nalumno@pc1:~$ ./saludo.sh\nHola, alumno, desde pc1'),
      h('Worth knowing'),
      list(
        'The shell is interactive: it reads /etc/bash.bashrc and ~/.bashrc, keeps the history and shows Ubuntu’s coloured prompt.',
        'Scripts work: nano script.sh, chmod +x script.sh and ./script.sh (with #!/bin/bash), or bash script.sh.',
        'help shows the built-in commands and man the help for each program; this tab has the complete reference.',
        'exit in the local terminal opens a new session; in an SSH session, it closes it.',
        'There is no package manager (apt) and there are no real processes: background jobs finish immediately.',
      ),
      note('Everything written to the device’s disk (home, scripts, changes in /etc) is saved with the topology.'),
      tip('Tab and the arrows', 'Tab completes command and file names; ↑ and ↓ go through the history; Ctrl+R searches it. Typing less is making fewer mistakes.'),
      warn('Common mistakes', 'Typing `saludo.sh` instead of `./saludo.sh`: the current directory is not in the PATH (“command not found”). Using double quotes with a `!` inside in the terminal: bash tries to expand the history (“event not found”); use single quotes. Forgetting `sudo` to touch system files.'),
      note('«Date and time stamped prompt» checkbox (at the foot of the terminal): like running PS1="\\[\\e[32m\\]\\d \\[\\e[36m\\]\\A \\[\\e[33m\\]\\u@\\h:\\w\\$ \\[\\e[0m\\]": the date in green, the time in cyan and user@host:path in yellow, with the simulated time. It is a general setting of this browser, off by default (also in Settings → General): it applies to every GNU/Linux and Windows terminal and to SSH sessions; unticking it brings back the previous PS1. A nested bash or su reads its .bashrc, as on Ubuntu. In a classroom the teacher may lock it.'),
      exercise('A script that reports', 'On PC1 of the «Server: DHCP, DNS, web, mail and SSH» lab, create `info.sh` showing the device name, its IP address and its gateway, and run it.', 'Contents: `#!/bin/bash`, `echo "Device: $(hostname)"`, `echo "IP address: $(hostname -I)"` and `echo "Gateway: $(ip r | grep default | cut -d" " -f3)"`. Then `chmod +x info.sh` and `./info.sh` shows pc1, 192.168.10.50 and 192.168.10.1.'),
    ],
  },
  {
    id: 'linux-ficheros',
    title: 'File system and permissions',
    summary: 'Directory tree, files generated by the simulation, /var/www/html and how to read and change permissions.',
    markdownBase: MD,
    blocks: [
      table(['Path', 'Contents'], [
        ['/home/alumno · /home/admin · /root', 'Home directories (.bashrc, .profile, .bash_history)'],
        ['/etc/passwd · /etc/group · /etc/shadow', 'The device’s accounts, generated from the SSH accounts (shadow for root only)'],
        ['/etc/hostname · /etc/resolv.conf · /etc/netplan/50-cloud-init.yaml', 'Generated: they follow the device’s IP configuration (resolv.conf has a “search” line with the netplan and DHCP domains)'],
        ['/etc/hosts', 'An ordinary file that root edits (sudo nano /etc/hosts): ping, ssh, curl, the browser and the Windows terminal (which shares the GNU/Linux file system) check it before DNS; nslookup, host and dig ask the DNS server only. hostname -f gives the first name on the device’s line. It is saved with the topology.'],
        ['/etc/kea · /etc/bind · /etc/postfix · /etc/dovecot · /etc/ssh/sshd_config', 'Generated on servers: they follow the Services tab'],
        ['/var/lib/kea/kea-leases4.csv', 'Current DHCP leases'],
        ['/var/www/html', 'The web server’s pages (read and write with sudo)'],
        ['/usr/bin · /usr/sbin', 'Programs'],
        ['/tmp', 'Temporary (everyone can write; sticky bit)'],
        ['/dev/null · /dev/zero · /dev/random · /dev/tty', 'Devices'],
        ['/proc/version · /proc/cpuinfo · /proc/meminfo', 'System information'],
      ]),
      p('Generated files are read-only (“Read-only file system”): they are changed from the interface (TCP/IP, Services) and the terminal sees the change immediately.'),
      h('Permissions'),
      p('Every file has an **owner**, a **group** and three permission triplets: **r** (read), **w** (write) and **x** (execute, or enter if it is a directory), for the owner, the group and the others.'),
      table(['ls -l column', 'Example', 'Meaning'], [
        ['Type and permissions', '-rw-r-----', 'File (-); the owner reads and writes; the group reads; the others, nothing.'],
        ['Owner · group', 'root shadow', 'Only root and the shadow group can read it.'],
        ['In octal', '640', 'r=4, w=2, x=1 added up per triplet: 6 (rw-), 4 (r--), 0 (---).'],
      ]),
      term('shell', 'alumno@pc1:~$ ls -l /etc/shadow\n-rw-r----- 1 root shadow 67 Oct 24 10:44 /etc/shadow\nalumno@pc1:~$ cat /etc/shadow\ncat: /etc/shadow: Permission denied\nalumno@pc1:~$ echo x > /etc/resolv.conf\nbash: /etc/resolv.conf: Read-only file system'),
      code('$ chmod 750 script.sh      # rwxr-x---\n$ chmod u+x,go-w script.sh\n$ umask 022\n$ sudo chown root:root f'),
      list(
        'Read, write and execute are checked for owner, group and others, as are the sticky bit on /tmp and execute permission on directories.',
        'root can read and write everything except generated files.',
        'Limits: 256 KiB per file and 4 MiB per device (“File too large”, “No space left on device”).',
      ),
      warn('Permission denied or Read-only file system', 'They are different errors. “Permission denied”: your user has no permission (look at `ls -l` and use sudo if appropriate). “Read-only file system”: it is a file generated by Netfix, not even root changes it; it is changed in the interface (TCP/IP, Services).'),
      exercise('A private script', 'On PC1, set `saludo.sh` (from “The GNU/Linux terminal”) so that you can read, change and run it, your group can only read it, and the others nothing. Which octal number do you use?', 'Not 750: the group could run it. It is `chmod 740 saludo.sh`: 7 (rwx) for you, 4 (r--) for the group and 0 for the others. `ls -l saludo.sh` shows `-rwxr-----`.'),
    ],
  },
  {
    id: 'linux-programas',
    title: 'GNU/Linux Terminal programs',
    summary: 'All the available utilities with their options, and how to chain them with pipes.',
    markdownBase: MD,
    blocks: [
      p('Every program accepts the usual GNU options and produces its own error messages. man PROGRAM shows this same information in the terminal.'),
      tip('Chain programs', 'GNU/Linux’s strength is combining small programs with `|` (a pipe): the output of one is the input of the next. `grep bash /etc/passwd | cut -d: -f1` lists the accounts that use bash.'),
      term('shell', 'alumno@pc1:~$ grep bash /etc/passwd | cut -d: -f1\nroot\nalumno\nalumno@pc1:~$ grep -c bash /etc/passwd\n2'),
      exercise('How many accounts are there?', 'On SRV of the «Server: DHCP, DNS, web, mail and SSH» lab, count the lines of /etc/passwd and list only the names of the accounts with their home in /home.', '`wc -l /etc/passwd` counts 4 lines. `grep :/home/ /etc/passwd | cut -d: -f1` shows only admin: it is the terminal’s account and also the lab’s only SSH account (each new SSH account would have its /home).'),
      ...utilityBlocks(['ficheros', 'texto', 'sistema', 'shell', 'editores']),
    ],
  },
  {
    id: 'linux-red',
    title: 'Network and services from GNU/Linux',
    summary: 'Diagnosing the network in four steps, and the reference for ip, ping, dig, resolvectl, curl, wget, ssh, dhclient, ss, systemctl and journalctl.',
    markdownBase: MD,
    blocks: [
      h('Step by step: why do I have no network?'),
      steps(
        ['Do I have an IP address?', '`ip -br a`: the interface must be UP and have its IP address. If you see 169.254.x.x or nothing, the problem is DHCP or the cable.'],
        ['Do I have a gateway?', '`ip r`: there must be a “default via …” line.'],
        ['Do I reach the gateway?', '`ping -c 1` to that IP address. If it does not answer, the problem is on the local network.'],
        ['Do I resolve names?', '`dig +short` of a known name. If it does not answer but pinging an IP address does, the problem is DNS.'],
      ),
      term('shell', 'alumno@pc1:~$ ip -br a\nlo               UNKNOWN        127.0.0.1/8\neth0             UP             192.168.10.50/24\nalumno@pc1:~$ ip r\ndefault via 192.168.10.1 dev eth0 proto dhcp metric 100\n192.168.10.0/24 dev eth0 proto kernel scope link src 192.168.10.50\nalumno@pc1:~$ ping -c 1 192.168.10.1\nPING 192.168.10.1 (192.168.10.1) 56(84) bytes of data.\n64 bytes from 192.168.10.1: icmp_seq=1 ttl=255 time=0.400 ms\nalumno@pc1:~$ dig +short srv.aula.lab\n192.168.10.2'),
      check('Read the TTLs', 'The reply’s ttl gives the device away: 255 a Cisco, 64 a GNU/Linux, 128 a Windows (minus one for each router it crosses).'),
      ...utilityBlocks(['red', 'servicios']),
      h('Examples'),
      code('$ ip r\ndefault via 192.168.10.1 dev eth0 proto dhcp metric 100\n$ dig +short www.aula.lab\nsrv.aula.lab.\n192.168.10.2\n$ resolvectl query www.aula.lab\nwww.aula.lab: 192.168.10.2                  -- link: eth0\n                (srv.aula.lab)\n$ resolvectl dns\nGlobal:\nLink 2 (eth0): 192.168.10.2\n$ curl -I http://www.aula.lab\nHTTP/1.1 200 OK\nServer: Apache/2.4.62 (Ubuntu)\n$ ping -c 1 noexiste.aula.lab\nping: noexiste.aula.lab: Name or service not known\n$ systemctl stop apache2\nFailed to stop apache2.service: Interactive authentication required.'),
      exercise('Break it and fix it', 'On PC1 of the «Server: DHCP, DNS, web, mail and SSH» lab, remove the DNS server from its configuration (TCP/IP → Static, with no DNS server) and follow the step by step. Which step fails?', 'Steps 1 to 3 work (IP address, “default via 192.168.10.1” and ping to the gateway), but `dig +short srv.aula.lab` ends in “;; no servers could be reached” and `ping srv.aula.lab` says “Temporary failure in name resolution”: DNS fails. Put 192.168.10.2 back (or DHCP).'),
    ],
  },
];
