/** Documentación: router Linux (parámetros, nftables y WireGuard). */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const SECURITY_DOCS: DocGroup = {
  id: 'seguridad',
  title: 'Seguridad y VPN',
  pages: [
    {
      id: 'linux-router',
      title: 'Router Linux',
      summary: 'Hardware de un 2911 con Ubuntu: eth0-eth2, ip_forward, rutas, NAT con nftables y gestión web.',
      blocks: [
        p('El Router Linux tiene los puertos de un 2911 (GigabitEthernet0/0-2) y el software de Server: los puertos se llaman eth0, eth1 y eth2 en la terminal. Solo reenvía paquetes entre interfaces si net.ipv4.ip_forward = 1.'),
        note('Imprescindible: sin net.ipv4.ip_forward = 1 el Router Linux no enruta. Responde a ping en sus propias direcciones, pero descarta todo lo que tenga que pasar de una interfaz a otra. Actívalo en Servicios → Parámetros (aplica y guarda en /etc/sysctl.d) o con sysctl en la terminal.'),
        note('Casilla «Activar router»: en Servicios → Parámetros está marcada cuando net.ipv4.ip_forward = 1 y desmarcada cuando vale 0. Allí no se puede pulsar: solo refleja el parámetro, que se cambia en la tabla o con sysctl. En la gestión web (Seguridad → Enrutamiento) la misma casilla sí se puede marcar y desmarcar: al guardar cambia ip_forward y lo guarda en /etc/sysctl.d/99-netfix.conf.'),
        code('root@linuxrouter0:~# ip addr add 192.168.1.1/24 dev eth1\nroot@linuxrouter0:~# ip route add 10.20.0.0/16 via 192.168.1.254\nroot@linuxrouter0:~# sysctl -w net.ipv4.ip_forward=1\nroot@linuxrouter0:~# echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-router.conf'),
        table(['Dónde', 'Qué se configura'], [
          ['Pestaña Interfaces', 'Dirección de cada eth, DHCP en eth0, rutas estáticas y reenvío.'],
          ['Servicios → Parámetros y Firewall', 'Parámetros del núcleo (sysctl: net.ipv4.ip_forward…) y nftables (tablas, cadenas, reglas, plantillas); se aplica y se guarda.'],
          ['Servicios → VPN', 'Túnel WireGuard wg0.'],
          ['Gestión web (Seguridad)', 'Las mismas opciones en la gestión web (menú lateral y tarjetas), con la casilla «Activar router» en Enrutamiento.'],
          ['Terminal', 'ip, sysctl, nft, wg, wg-quick, systemctl, journalctl, dmesg, nc, nmap.'],
        ]),
        note('Lo hecho con ip, sysctl -w o nft cambia lo que está en marcha; para que dure, guárdalo en /etc/sysctl.d, /etc/nftables.conf o con los paneles, que aplican y guardan.'),
      ],
    },
    {
      id: 'linux-nftables',
      title: 'Cortafuegos nftables',
      summary: 'Tablas, cadenas con gancho, reglas con ct state, NAT (masquerade, dnat), log y nftables.service.',
      blocks: [
        p('nftables filtra en los ganchos input (para el equipo), forward (en tránsito), output (generado por el equipo) y prerouting/postrouting (NAT). conntrack recuerda las conexiones, así que «ct state established,related accept» deja pasar las respuestas.'),
        code('table inet filter {\n  chain input {\n    type filter hook input priority filter; policy drop;\n    ct state established,related accept\n    iifname "lo" accept\n    tcp dport 22 ip saddr 192.168.10.0/24 accept\n    log prefix "NFT-DROP " drop\n  }\n}\ntable ip nat {\n  chain prerouting {\n    type nat hook prerouting priority dstnat; policy accept;\n    iifname "eth0" tcp dport 80 dnat to 172.16.0.80\n  }\n  chain postrouting {\n    type nat hook postrouting priority srcnat; policy accept;\n    oifname "eth0" masquerade\n  }\n}'),
        table(['Orden', 'Efecto'], [
          ['sudo nft list ruleset', 'Reglas en marcha (con -a, los handles).'],
          ['sudo nft add rule inet filter input tcp dport 80 accept', 'Añade una regla al final, detrás de un «log … drop» no se alcanzaría (insert: al principio).'],
          ['sudo nft delete rule inet filter input handle 7', 'Borra una regla por su handle.'],
          ['sudo nft -f /etc/nftables.conf · nft -c -f …', 'Carga un fichero de forma atómica / solo lo comprueba.'],
          ['sudo systemctl enable --now nftables', 'Carga /etc/nftables.conf al arrancar.'],
          ['sudo dmesg', 'Líneas de las reglas con log prefix.'],
        ]),
        list(
          'Comprobar el filtrado: nc -zv HOST PUERTO («succeeded», «Connection refused» con reject o «timed out» con drop) y nmap -p 22,80 HOST.',
          'Las plantillas del panel (servidor bastionado, router con NAT, todo permitido) sustituyen todas las reglas; la gestión web impide guardar un cambio que te deje sin acceso a ella.',
        ),
      ],
    },
    {
      id: 'linux-wireguard',
      title: 'VPN WireGuard',
      summary: 'wg genkey/pubkey, /etc/wireguard/wg0.conf, wg-quick, AllowedIPs, endpoint, PersistentKeepalive.',
      blocks: [
        p('WireGuard une dos routers Linux con un túnel UDP (puerto 51820). Cada extremo tiene una clave privada y conoce la pública del otro (X25519, las mismas claves que el wg real). AllowedIPs indica qué redes llegan por cada par y se convierten en rutas por wg0.'),
        code('root@central:~# umask 077; wg genkey | tee /etc/wireguard/private.key | wg pubkey\nroot@central:~# cat /etc/wireguard/wg0.conf\n[Interface]\nAddress = 10.99.0.1/24\nListenPort = 51820\nPrivateKey = (clave privada de la central)\n\n[Peer]\nPublicKey = (clave pública de la sucursal)\nAllowedIPs = 10.99.0.2/32, 10.2.0.0/24\nroot@central:~# systemctl enable --now wg-quick@wg0\nroot@central:~# wg show'),
        list(
          'El lado que está detrás de NAT pone Endpoint = IP_pública:51820 y PersistentKeepalive = 25: así abre el NAT y la central aprende su dirección (wg show wg0 endpoints).',
          'Abre UDP 51820 en la cadena input y deja pasar el tráfico de wg0 en forward; la masquerade solo debe aplicarse a la salida por eth0.',
          'PostUp/PostDown en wg0.conf se ejecutan con bash (%i es la interfaz), por ejemplo para añadir reglas nft.',
          'Si la clave pública de un par no coincide, el handshake nunca termina: wg show no muestra «latest handshake».',
        ),
        table(['Orden', 'Efecto'], [
          ['wg-quick up wg0 · down wg0', 'Levanta o quita el túnel según /etc/wireguard/wg0.conf.'],
          ['wg show · wg showconf wg0', 'Estado (handshake, bytes, endpoint) / configuración en uso.'],
          ['wg set wg0 peer CLAVE allowed-ips … endpoint IP:PUERTO', 'Cambia un par en marcha.'],
          ['ip a · ip route', 'wg0 aparece como interfaz POINTOPOINT y sus rutas «dev wg0».'],
        ]),
      ],
    },
  ],
};
