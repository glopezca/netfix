/** Documentation: spanning tree (PVST+) on 2960 switches, in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, figure, h, list, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const STP_DOCS: readonly DocPage[] = [
  {
    id: 'ios-stp',
    title: 'Spanning tree',
    summary: 'Why two paths between switches make a loop, how STP elects the root and which port blocks, and how to change it.',
    markdownBase: MD,
    blocks: [
      p('Two switches joined by two paths form a **loop**: a broadcast frame (an ARP, a DHCP DISCOVER) would go round for ever and flood the network. **Spanning tree** (STP, IEEE 802.1D) prevents it: the switches choose a loop-free tree and **block** the ports left over. If a link of the tree fails, a blocked port starts forwarding. 2960 switches run **PVST+**: one tree per VLAN.'),
      figure({
        type: 'topology',
          nodes: [
            { id: 'gw', kind: 'router', label: 'GW', x: 40, y: 0 },
            { id: 'core', kind: 'switch', label: 'SW-CORE', x: 40, y: 18, note: 'root' },
            { id: 'a', kind: 'switch', label: 'SW-A', x: 15, y: 36 },
            { id: 'b', kind: 'switch', label: 'SW-B', x: 65, y: 36 },
            { id: 'pc0', kind: 'pc', label: 'PC0', x: 15, y: 54 },
            { id: 'pc1', kind: 'pc', label: 'PC1', x: 65, y: 54 },
          ],
          links: [{ a: 'gw', b: 'core' }, { a: 'core', b: 'a', label: 'Gi0/1' }, { a: 'core', b: 'b', label: 'Gi0/2' }, { a: 'a', b: 'b', label: 'Gi0/2 · blocks on SW-A' }, { a: 'a', b: 'pc0' }, { a: 'b', b: 'pc1' }],
      }, 'The lab “Spanning tree: three switches in a triangle”. SW-CORE is the root; the link between SW-A and SW-B blocks on SW-A (amber light).'),
      h('How the tree is chosen'),
      steps(
        ['The root', 'The lowest **bridge ID** wins: the priority (32768 by default, plus the VLAN number) and, on a tie, the lowest MAC.'],
        ['The root port', 'Each switch that is not the root keeps the port with the lowest **cost** to the root (FastEthernet 19, GigabitEthernet 4). On a tie: the one from the neighbour with the lowest ID, then the lowest port number.'],
        ['The designated port', 'On each link, the end with the lowest cost to the root forwards (on the root, all its ports).'],
        ['The rest block', 'A port that is neither root nor designated stays **Altn BLK**: it neither forwards frames nor learns MAC addresses.'],
      ),
      check('Check it', '`show spanning-tree` shows the root (or “This bridge is the root”) and the role and state of each port.'),
      term('ios', 'SW-A#show spanning-tree\nVLAN0001\n  Spanning tree enabled protocol ieee\n  Root ID    Priority    32769\n             Address     001a.6c86.ef5f\n             Cost        4\n             Port        25 (GigabitEthernet0/1)\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n\n  Bridge ID  Priority    32769  (priority 32768 sys-id-ext 1)\n             Address     00b3.648a.2322\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n             Aging Time  300 sec\n\nInterface           Role Sts Cost      Prio.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\nFa0/1               Desg FWD 19        128.1    P2p\nGi0/1               Root FWD 4         128.25   P2p\nGi0/2               Altn BLK 4         128.26   P2p'),
      h('Changing the root'),
      p('The root should be the central switch, not the one that happens to have the lowest MAC. Lower its priority (in multiples of 4096) or let IOS work it out with `root primary`.'),
      table(['Command', 'Use'], [
        ['spanning-tree vlan 1 priority 4096', 'Bridge priority for those VLANs (1,10,20 or 10-20). A value that is not a multiple of 4096 shows the allowed ones.'],
        ['spanning-tree vlan 1 root primary|secondary', 'Root: 24576, or 4096 less than the current root; secondary: 28672.'],
        ['no spanning-tree vlan 1', 'Turns STP off in that VLAN (the loop comes back).'],
        ['spanning-tree mode pvst|rapid-pvst', 'STP flavour (rapid-pvst: “protocol rstp”).'],
        ['spanning-tree cost N · spanning-tree port-priority N', 'On the interface: port cost and priority (multiples of 16, 128 by default).'],
        ['spanning-tree portfast · spanning-tree bpduguard enable', 'Ports with a single device (PC, server): “P2p Edge”.'],
        ['spanning-tree portfast bpduguard default', 'BPDU guard on every portfast port.'],
        ['show interfaces status [err-disabled]', 'State of each port: connected, notconnect, disabled or err-disabled.'],
        ['show spanning-tree [vlan N | interface IF | summary]', 'The tree of each VLAN, one port in all its VLANs or the summary.'],
      ]),
      tip('The amber light', 'As in Packet Tracer, the triangle at a cable end is painted amber on a port that blocks in all its VLANs.'),
      list(
        'In Netfix convergence is immediate: a real 2960 takes 30 s (Listening and Learning, 15 s each) to put a port to forwarding, unless it has portfast.',
        'When the tree changes, the switch flushes its MAC address table, as on a topology change notification.',
        '**BPDU guard** protects single-device ports: if BPDUs from a switch arrive on one with `spanning-tree bpduguard enable` (or with portfast and `spanning-tree portfast bpduguard default`), the port goes **err-disabled** (%SPANTREE-2-BLOCK_BPDUGUARD) and the link drops. `show interfaces status err-disabled` shows it; `shutdown` and `no shutdown` recover it once the switch is gone.',
      ),
      warn('Common mistakes', '`no spanning-tree vlan 1` with two paths between switches: the network floods and stops answering. A priority that is not a multiple of 4096. Expecting the switch with most ports to be the root: the priority decides and, on a tie, the MAC.'),
      exercise('Another root', 'In the lab “Spanning tree: three switches in a triangle”, make SW-A the root. Which port blocks now?', 'On SW-A: `enable`, `conf t`, `spanning-tree vlan 1 root primary` (priority 24576). SW-B reaches SW-A directly through Gi0/2 (cost 4) and SW-CORE through Gi0/1. On the SW-CORE–SW-B link both are at cost 4 from the root and the lowest MAC wins (SW-CORE), so **Gi0/1 on SW-B** blocks: `show spanning-tree` on SW-B shows “Gi0/1 Altn BLK”. The ping from PC0 to PC1 still works.'),
    ],
  },
];
