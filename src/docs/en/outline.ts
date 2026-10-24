/** Order of the Documentation tab (English): the same groups, sections and pages as src/docs/outline.ts. */
import type { OutlineGroup } from '../outline.ts';

export const OUTLINE: readonly OutlineGroup[] = [
  { id: 'netfix', title: 'Netfix', sections: [[null, ['inicio', 'dibujo', 'guardar', 'simulacion', 'usuarios']]] },
  { id: 'pc', title: 'PC', icon: 'pc', sections: [[null, ['pc-ip', 'pc-equipo', 'pc-apps', 'windows-cmd']]] },
  {
    id: 'servidor', title: 'Server', icon: 'server', sections: [
      ['General', ['srv-intro']],
      ['SSH', ['srv-ssh', 'srv-ssh-claves', 'srv-sshd-config', 'srv-sftp']],
      ['DHCP', ['srv-dhcp']],
      ['DNS', ['srv-dns', 'srv-dns-names']],
      ['HTTP', ['srv-http', 'srv-apache', 'srv-webadmin', 'srv-roundcube']],
      ['Mail', ['srv-mail']],
      ['Configuration and logs', ['srv-config-logs']],
    ],
  },
  { id: 'switch', title: 'IOS switch', icon: 'switch', sections: [['IOS CLI', ['ios-cli', 'ios-show']], ['Interfaces and VLANs', ['ios-otros']], ['Web management', ['ios-web']]] },
  { id: 'router', title: 'IOS router', icon: 'router', sections: [['DHCP', ['ios-dhcp', 'ios-reservas', 'ios-relay']], ['NAT and ACLs', ['ios-nat', 'ios-acl']], ['VPN', ['ios-ipsec']]] },
  { id: 'linuxrouter', title: 'Linux router', icon: 'linuxrouter', sections: [['Parameters', ['linux-router']], ['Firewall', ['linux-nftables']], ['VPN', ['linux-wireguard']]] },
  { id: 'nube', title: 'ISP cloud', icon: 'cloud', sections: [[null, ['inet-cloud', 'inet-dns']]] },
  { id: 'red', title: 'Networking concepts', sections: [[null, ['red-broadcast', 'inet-trace']]] },
  { id: 'linux', title: 'Linux Terminal', sections: [[null, ['linux-intro', 'linux-ficheros', 'linux-programas', 'linux-red']], ['Midnight Commander', ['mc']], ['Editors', ['nano', 'vim']]] },
  {
    id: 'bash', title: 'GNU bash 5.3', sections: [
      ['Language', ['bash-sintaxis', 'bash-expansiones', 'bash-control', 'bash-funciones', 'bash-redirecciones']],
      ['Reference', ['bash-variables', 'bash-opciones', 'bash-interactivo', 'bash-53', 'bash-builtins']],
    ],
  },
];
