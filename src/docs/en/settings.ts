/** Documentation: the Settings tab (general settings and those of the current lab), in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, h, p, steps, table, tip } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const SETTINGS_DOCS: readonly DocPage[] = [
  {
    id: 'configuracion',
    title: 'Settings',
    summary: 'Language, theme and the unsaved-changes question; and which settings each kind of device shows in the open lab.',
    markdownBase: MD,
    blocks: [
      p('The **Settings** tab (next to Help) has two sections. **General** applies to any network and is kept in this browser. **Current lab** belongs to the open network: it is saved with it when you press Save, and travels in the .netfix.json file.'),
      h('General'),
      table(['Setting', 'What it does'], [
        ['Language', 'Español (España) or English (UK), like the drop-down in the top bar.'],
        ['Theme', 'Automatic (the system’s), light or dark.'],
        ['Ask before replacing…', 'When unticked, Labs, New and Open replace the network without asking even if it has unsaved changes.'],
        ['Date and time stamped prompt', 'Off by default. Puts the date and time in the prompt of every GNU/Linux and Windows terminal (the same box is at the foot of each terminal). In the classroom the teacher may fix it.'],
      ]),
      h('Current lab'),
      p('Decides which tabs and panels the windows of each kind of device show. **Device** (host name) and **Interfaces** are always there.'),
      table(['Device', 'On by default', 'Can be turned on'], [
        ['PC', 'TCP/IP, applications (browser, mail, SSH, SFTP), GNU/Linux terminal and Windows terminal', '—'],
        ['Server', 'TCP/IP, each service (SSH, DHCP, DNS, HTTP, mail, files and logs), kernel parameters, firewall, GNU/Linux terminal and Windows terminal', '—'],
        ['GNU/Linux router', 'Kernel parameters, firewall, VPN, each service and GNU/Linux terminal', 'Windows terminal'],
        ['IOS router and switch', 'CLI and web management', '—'],
      ]),
      p('The recorded labs limit nothing here: each device’s Settings tab shows only what it uses (below), so a service ticked or installed with apt always shows.'),
      h('Each device’s Settings tab'),
      p('Every PC, server and GNU/Linux router also has its own **Settings** tab: boxes for its applications, services and terminals. It only lists what the lab allows (the table above is the maximum), and when a box changes the window reopens on that tab with the new tabs.'),
      table(['Device', 'On by default', 'Off by default'], [
        ['PC', 'TCP/IP, browser, SSH client and the terminal of its operating system', 'Mail, Files (SFTP) and the other system’s terminal'],
        ['Server', 'Placed from the palette: TCP/IP, files, logs and the GNU/Linux terminal. Kernel parameters always (no box)', 'Every service and the firewall: ticked here or installed with apt (Installing packages with apt)'],
        ['GNU/Linux router', 'Placed from the palette: files, logs and the GNU/Linux terminal. Kernel parameters always', 'Services, firewall and VPN (box or apt)'],
      ]),
      p('In the recorded labs, of each pair of PCs on the same switch one runs Windows and the other GNU/Linux; mail is only on the PCs with an account set up, and SFTP on PC1 of “SSH and SFTP with keys”; each server shows only the services it starts (plus files and logs).'),
      p('The servers of the recorded labs and of saved files keep the services they had.'),
      p('When you **place a PC** from the palette, Netfix asks whether it runs GNU/Linux, Windows or both, and turns on its terminal and that system’s network stack (TCP/IP → operating system). It can be changed later. Servers do not ask: they run GNU/Linux.'),
      p('The **web management** of servers and GNU/Linux routers shows greyed out, without forms, the pages of whatever is off (on the device or in the lab). With the **Hide disabled options in the web management…** box of Current lab they are not even in the menu.'),
      steps(
        ['Open the tab', '**Settings**, section **Current lab**.'],
        ['Tick or untick', 'Each box applies at once. Open windows close: when opened again they have the new tabs.'],
        ['Save', 'It is a change to the network: **Save** puts it in the file, and changing lab without saving asks first.'],
      ),
      check('Check it', 'Untick **Windows terminal** for PC and open a PC: it no longer has that tab. **Restore the defaults** brings it back.'),
      tip('In the classroom', 'Embedded in a Netfix Classroom exercise, the lab section is read-only, and the teacher’s restrictions still rule: a tab the teacher hides does not appear even if it is ticked here.'),
      exercise('A server with a firewall', 'In the lab “Server: DHCP, DNS, web, mail and SSH”, make the server show the Firewall panel and check that it does not block web access.', 'In the SRV window, **Settings** tab, tick **Firewall** (or in its terminal `sudo apt install nftables`). Then, Services → Firewall appears with its service stopped. From PC0, the browser still opens http://www.aula.lab as long as you do not start nftables with rules that prevent it.'),
    ],
  },
];
