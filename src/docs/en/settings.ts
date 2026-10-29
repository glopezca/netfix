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
      ]),
      h('Current lab'),
      p('Decides which tabs and panels the windows of each kind of device show. **Device** (host name) and **Interfaces** are always there.'),
      table(['Device', 'On by default', 'Can be turned on'], [
        ['PC', 'IP configuration, applications (browser, mail, SSH, SFTP), Linux terminal and Windows terminal', '—'],
        ['Server', 'IP configuration, services, Linux terminal and Windows terminal', 'Kernel parameters and firewall (in Services)'],
        ['Linux router', 'Kernel parameters, firewall, VPN, services and Linux terminal', 'Windows terminal'],
        ['IOS router and switch', 'CLI and web management', '—'],
      ]),
      steps(
        ['Open the tab', '**Settings**, section **Current lab**.'],
        ['Tick or untick', 'Each box applies at once. Open windows close: when opened again they have the new tabs.'],
        ['Save', 'It is a change to the network: **Save** puts it in the file, and changing lab without saving asks first.'],
      ),
      check('Check it', 'Untick **Windows terminal** for PC and open a PC: it no longer has that tab. **Restore the defaults** brings it back.'),
      tip('In the classroom', 'Embedded in a Netfix Classroom exercise, the lab section is read-only, and the teacher’s restrictions still rule: a tab the teacher hides does not appear even if it is ticked here.'),
      exercise('A server with a firewall', 'In the lab “Server: DHCP, DNS, web, mail and SSH”, make the server show the Firewall panel and check that it does not block web access.', 'Settings → Current lab → Server: tick **Firewall**. In the SRV window, Services → Firewall appears with its service stopped. From PC0, the browser still opens http://www.aula.lab as long as you do not start nftables with rules that prevent it.'),
    ],
  },
];
