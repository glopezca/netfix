/**
 * Order of the Ayuda tab (español): a group per device in the order of the palette (PC, Servidor, Switch
 * IOS, Router IOS, Router GNU/Linux, Nube) and, inside each one, its services in the order of its window. Every page of
 * the documentation appears exactly once (tests/docs/docs.test.ts).
 */
import type { GroupIcon } from './types.ts';
import { labsOutline } from './labs.ts';

export interface OutlineGroup {
  readonly id: string;
  readonly title: string;
  readonly icon?: GroupIcon;
  /** Sections in order: a title (null: no subheading) and the ids of its pages. */
  readonly sections: readonly (readonly [string | null, readonly string[]])[];
}

export const OUTLINE: readonly OutlineGroup[] = [
  { id: 'netfix', title: 'Netfix', sections: [[null, ['inicio', 'dibujo', 'guardar', 'simulacion', 'configuracion', 'usuarios', 'huevos']]] },
  { id: 'pc', title: 'PC', icon: 'pc', sections: [[null, ['pc-ip', 'pc-equipo', 'pc-apps', 'windows-cmd']]] },
  {
    id: 'servidor', title: 'Servidor', icon: 'server', sections: [
      ['General', ['srv-intro']],
      ['SSH', ['srv-ssh', 'srv-ssh-claves', 'srv-sshd-config', 'srv-sftp']],
      ['DHCP', ['srv-dhcp']],
      ['DNS', ['srv-dns', 'srv-dns-names']],
      ['HTTP', ['srv-http', 'srv-apache', 'srv-webadmin', 'srv-roundcube']],
      ['Correo', ['srv-mail']],
      ['Configuración y registros', ['srv-config-logs']],
    ],
  },
  { id: 'switch', title: 'Switch IOS', icon: 'switch', sections: [['CLI de IOS', ['ios-cli', 'ios-show']], ['Interfaces y VLAN', ['ios-otros']], ['Spanning tree', ['ios-stp']], ['Gestión web', ['ios-web']]] },
  { id: 'router', title: 'Router IOS', icon: 'router', sections: [['DHCP', ['ios-dhcp', 'ios-reservas', 'ios-relay']], ['NAT y ACL', ['ios-nat', 'ios-acl']], ['VPN', ['ios-ipsec']]] },
  { id: 'linuxrouter', title: 'Router GNU/Linux', icon: 'linuxrouter', sections: [['Parámetros', ['linux-router']], ['Cortafuegos', ['linux-nftables']], ['VPN', ['linux-wireguard']]] },
  { id: 'nube', title: 'Nube ISP', icon: 'cloud', sections: [[null, ['inet-cloud', 'inet-dns']]] },
  { id: 'red', icon: 'network', title: 'Conceptos de red', sections: [[null, ['red-broadcast', 'red-nombres', 'inet-trace']]] },
  { id: 'linux', icon: 'terminal', title: 'Terminal GNU/Linux', sections: [[null, ['linux-intro', 'linux-ficheros', 'linux-programas', 'linux-red', 'linux-apt']], ['Midnight Commander', ['mc']], ['Editores', ['nano', 'vim']]] },
  {
    id: 'bash', icon: 'script', title: 'GNU bash 5.3', sections: [
      ['Lenguaje', ['bash-sintaxis', 'bash-expansiones', 'bash-control', 'bash-funciones', 'bash-redirecciones']],
      ['Referencia', ['bash-variables', 'bash-opciones', 'bash-interactivo', 'bash-53', 'bash-builtins']],
    ],
  },
  labsOutline('es-ES', 'Laboratorios'),
];
