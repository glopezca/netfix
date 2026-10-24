/** Documentación: router Linux (parámetros, nftables y WireGuard), en estilo guiado. */
import type { DocGroup } from './types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/glopezca/netfix/blob/main/';

export const SECURITY_DOCS: DocGroup = {
  id: 'seguridad',
  title: 'Router Linux',
  pages: [
    {
      id: 'linux-router',
      title: 'Router Linux',
      summary: 'Un Ubuntu con tres puertos que enruta: interfaces, ip_forward, rutas, NAT y dónde se configura cada cosa.',
      markdownBase: MD,
      blocks: [
        p('El **Router Linux** tiene los puertos de un 2911 (GigabitEthernet0/0-2) y el software de un Server con Ubuntu: en la terminal los puertos se llaman **eth0**, **eth1** y **eth2**. Es como montar un router con un PC y tres tarjetas de red: enruta, hace NAT y filtra con **nftables**, y puede unir sedes con **WireGuard**.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'isp', kind: 'cloud', label: 'ISP-Norte', x: 40, y: 0 },
            { id: 'fw', kind: 'linuxrouter', label: 'FW', x: 40, y: 20, note: 'eth0 81.32.5.2' },
            { id: 'lan', kind: 'switch', label: 'Switch0', x: 10, y: 40, note: 'eth1 · LAN 192.168.1.0/24' },
            { id: 'dmz', kind: 'server', label: 'WEB-DMZ', x: 75, y: 40, note: 'eth2 · DMZ 172.16.0.80' },
          ],
          links: [{ a: 'isp', b: 'fw' }, { a: 'fw', b: 'lan', label: 'eth1' }, { a: 'fw', b: 'dmz', label: 'eth2' }],
        }, 'El laboratorio «Router Linux con NAT y DMZ (nftables)»: Internet por eth0, la LAN por eth1 y la DMZ con el servidor web por eth2.'),
        h('Paso a paso: que enrute'),
        steps(
          ['Direcciones de las interfaces', 'Pestaña **Interfaces** (o `ip addr add 192.168.1.1/24 dev eth1`). eth0 puede pedir la suya por DHCP al operador.'],
          ['Activa el reenvío', '**Servicios → Parámetros**: `net.ipv4.ip_forward` = 1 y **Aplicar y guardar**. Sin él, el router responde a ping en sus direcciones IP pero descarta todo lo que pasa de una interfaz a otra.'],
          ['Rutas', 'Las redes conectadas se añaden solas; las demás con `ip route add RED via SIGUIENTE` o en la pestaña Interfaces.'],
          ['NAT de salida', '**Servicios → Firewall → Plantilla** «Router con NAT de salida por eth0», o una regla `oifname "eth0" masquerade` (ver nftables).'],
        ),
        term('shell', 'root@fw:~# ip -br addr\nlo               UNKNOWN        127.0.0.1/8\neth0             UP             81.32.5.2/29\neth1             UP             192.168.1.1/24\neth2             UP             172.16.0.1/24\nroot@fw:~# sysctl net.ipv4.ip_forward\nnet.ipv4.ip_forward = 1\nroot@fw:~# ip route\ndefault via 81.32.5.1 dev eth0 proto dhcp metric 100\n81.32.5.0/29 dev eth0 proto kernel scope link src 81.32.5.2\n172.16.0.0/24 dev eth2 proto kernel scope link src 172.16.0.1\n192.168.1.0/24 dev eth1 proto kernel scope link src 192.168.1.1'),
        note('La casilla **Activar router** de Servicios → Parámetros solo refleja net.ipv4.ip_forward (marcada si vale 1); se cambia en la tabla o con sysctl. En la gestión web (Seguridad → Enrutamiento) la misma casilla sí se puede marcar: al guardar cambia ip_forward y lo guarda en /etc/sysctl.d/99-netfix.conf.'),
        table(['Dónde', 'Qué se configura'], [
          ['Pestaña Interfaces', 'Dirección IP de cada eth, DHCP en eth0, rutas estáticas y reenvío.'],
          ['Servicios → Parámetros', 'Parámetros del núcleo (sysctl: net.ipv4.ip_forward…); se aplica y se guarda.'],
          ['Servicios → Firewall', 'nftables: tablas, cadenas, reglas y plantillas.'],
          ['Servicios → VPN', 'Túnel WireGuard wg0.'],
          ['Gestión web (Seguridad)', 'Enrutamiento, Firewall y VPN en el navegador.'],
          ['Terminal', 'ip, sysctl, nft, wg, wg-quick, systemctl, journalctl, dmesg, nc, nmap.'],
        ]),
        tip('Sus servicios son los del Server', 'Después de Parámetros, Firewall y VPN, el menú Servicios sigue con SSH, DHCP, DNS, HTTP, Correo, Configuración y Registros, iguales que en un Server: consulta sus páginas en el grupo Servidor.'),
        warn('Errores habituales', 'Olvidar ip_forward: los PC llegan al router pero no más allá. Hacer `sysctl -w` o `ip route add` y no guardarlo: se pierde al reiniciar (guárdalo en /etc/sysctl.d, en /etc/nftables.conf o con los paneles, que aplican y guardan). Sin NAT de salida, Internet no sabe volver a la LAN privada.'),
        exercise('Apágale el reenvío', 'En el laboratorio «Router Linux con NAT y DMZ (nftables)», comprueba que PC0 hace ping a 8.8.8.8. Después pon net.ipv4.ip_forward a 0 en FW y repite.', 'Con el reenvío activo, `ping -c 1 8.8.8.8` responde. Tras `sysctl -w net.ipv4.ip_forward=0` en FW (o 0 en Servicios → Parámetros), el mismo ping acaba en «1 packets transmitted, 0 received, 100% packet loss»: FW ya no pasa paquetes de eth1 a eth0. Vuelve a ponerlo a 1.'),
      ],
    },
    {
      id: 'linux-nftables',
      title: 'Cortafuegos nftables',
      summary: 'Tablas, cadenas con gancho, reglas con ct state, NAT (masquerade, dnat), log y cómo comprobarlo.',
      markdownBase: MD,
      blocks: [
        p('**nftables** es el cortafuegos de Linux. Las reglas viven en **cadenas** colgadas de un **gancho**: **input** (lo que va al propio equipo), **forward** (lo que pasa por él), **output** (lo que genera) y **prerouting/postrouting** (NAT). Cada cadena tiene una **política** por defecto (accept o drop). **conntrack** recuerda las conexiones: `ct state established,related accept` deja pasar las respuestas sin abrir nada más.'),
        figure({
          type: 'sequence',
          actors: ['CLIENTE-EXT', 'FW (nftables)', 'WEB-DMZ'],
          messages: [
            { from: 0, to: 1, text: 'TCP 80 → 81.32.5.2', note: 'prerouting: dnat to 172.16.0.80' },
            { from: 1, to: 2, text: 'TCP 80 → 172.16.0.80', note: 'forward: «web publicada» accept' },
            { from: 2, to: 1, text: '200 OK' },
            { from: 1, to: 0, text: '200 OK', note: 'forward: ct state established' },
          ],
        }, 'La web de la DMZ publicada en la dirección IP pública de FW: DNAT en prerouting, filtro en forward y conntrack para la vuelta.'),
        h('Paso a paso: un cortafuegos con DMZ'),
        steps(
          ['Empieza cerrado', 'Cadenas input y forward con `policy drop`: lo que no se permita, se descarta.'],
          ['Deja pasar las respuestas', '`ct state established,related accept` el primero, e `iifname "lo" accept` en input.'],
          ['Abre lo necesario', 'Una regla por necesidad, con comentario: administración solo desde la LAN, la LAN a todas partes, la DMZ solo a Internet, la web publicada.'],
          ['NAT', '`dnat to 172.16.0.80` en prerouting para publicar la web; `oifname "eth0" masquerade` en postrouting para salir.'],
          ['Registra lo descartado', '`log prefix "FW-DROP " drop` al final de forward: cada paquete descartado aparece en `dmesg`.'],
          ['Carga y guarda', '**Aplicar y guardar** en el panel, o el fichero /etc/nftables.conf con `nft -f` y `systemctl enable --now nftables`.'],
        ),
        term('nftables', 'table inet filter {\n  chain input {\n    type filter hook input priority filter; policy drop;\n    ct state established,related accept\n    iifname "lo" accept\n    iifname "eth1" tcp dport { 22, 10000 } accept comment "administracion solo desde la LAN"\n    icmp type echo-request accept\n  }\n  chain forward {\n    type filter hook forward priority filter; policy drop;\n    ct state established,related accept\n    iifname "eth1" accept comment "LAN a todas partes"\n    iifname "eth2" oifname "eth0" accept comment "DMZ solo a Internet"\n    iifname "eth0" oifname "eth2" ip daddr 172.16.0.80 tcp dport 80 accept comment "web publicada"\n    log prefix "FW-DROP " drop\n  }\n}\ntable ip nat {\n  chain prerouting {\n    type nat hook prerouting priority dstnat; policy accept;\n    iifname "eth0" tcp dport 80 dnat to 172.16.0.80\n  }\n  chain postrouting {\n    type nat hook postrouting priority srcnat; policy accept;\n    oifname "eth0" masquerade\n  }\n}'),
        check('Compruébalo', 'Desde fuera, la web responde en la dirección IP pública. Desde la DMZ hacia la LAN no pasa nada, y `dmesg` en FW lo cuenta.'),
        term('shell', 'alumno@cliente-ext:~$ curl -s http://81.32.5.2/ | head -1\n<!doctype html>\nadmin@web-dmz:~$ ping -c 1 -W 1 192.168.1.10\nPING 192.168.1.10 (192.168.1.10) 56(84) bytes of data.\n\n--- 192.168.1.10 ping statistics ---\n1 packets transmitted, 0 received, 100% packet loss, time 0ms\nroot@fw:~# dmesg | tail -1\n[35895.957000] FW-DROP IN=eth2 OUT=eth1 SRC=172.16.0.80 DST=192.168.1.10 LEN=60 TTL=128 PROTO=ICMP'),
        table(['Orden', 'Efecto'], [
          ['nft list ruleset', 'Reglas en marcha (con -a, los handles).'],
          ['nft add rule inet filter input tcp dport 80 accept', 'Añade una regla al final; detrás de un «log … drop» no se alcanzaría (insert: al principio).'],
          ['nft delete rule inet filter input handle 7', 'Borra una regla por su handle.'],
          ['nft -f /etc/nftables.conf · nft -c -f …', 'Carga un fichero de forma atómica / solo lo comprueba.'],
          ['systemctl enable --now nftables', 'Carga /etc/nftables.conf al arrancar.'],
          ['dmesg', 'Líneas de las reglas con log prefix.'],
          ['nc -zv HOST PUERTO · nmap -p 22,80 HOST', 'Prueba un puerto: «succeeded», «Connection refused» (reject) o «timed out» (drop).'],
        ]),
        list(
          'Las plantillas del panel (servidor bastionado, router con NAT, todo permitido) sustituyen todas las reglas.',
          'La gestión web impide guardar un cambio que te deje sin acceso a ella.',
        ),
        warn('Errores habituales', 'Poner policy drop sin `ct state established,related accept`: no vuelve ninguna respuesta. Añadir una regla con `add` detrás de un `drop` final: nunca se alcanza (usa `insert` o colócala antes). Filtrar en input lo que pasa por el router: el tránsito va por forward. Probar desde el propio router: su tráfico va por output, no por forward.'),
        exercise('¿Puede la DMZ entrar en la LAN?', 'En el laboratorio «Router Linux con NAT y DMZ (nftables)», haz ping desde WEB-DMZ a 192.168.1.10 y explica qué regla lo decide. Comprueba después que la web se ve desde CLIENTE-EXT.', 'El ping no recibe respuesta: en forward ninguna regla permite eth2 → eth1 («DMZ solo a Internet» solo deja eth2 → eth0), así que llega a `log prefix "FW-DROP " drop` y `dmesg` en FW muestra «FW-DROP IN=eth2 OUT=eth1 SRC=172.16.0.80 DST=192.168.1.10». `curl http://81.32.5.2/` en CLIENTE-EXT devuelve la página de WEB-DMZ gracias al dnat y a la regla «web publicada».'),
      ],
    },
    {
      id: 'linux-wireguard',
      title: 'VPN WireGuard',
      summary: 'Unir dos sedes con WireGuard paso a paso: claves, wg0.conf, AllowedIPs, Endpoint y PersistentKeepalive detrás de NAT.',
      markdownBase: MD,
      blocks: [
        p('**WireGuard** une dos routers Linux con un túnel UDP (puerto 51820). Cada extremo tiene una **clave privada** y conoce la **pública** del otro (X25519, las mismas claves que el wg real). **AllowedIPs** dice qué redes llegan por cada par, y se convierten en rutas por wg0.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'pc0', kind: 'pc', label: 'PC0', x: 0, y: 0, note: '10.1.0.10' },
            { id: 'c', kind: 'linuxrouter', label: 'CENTRAL', x: 30, y: 0, note: 'wg0 10.99.0.1' },
            { id: 's', kind: 'linuxrouter', label: 'SUCURSAL', x: 65, y: 0, note: 'wg0 10.99.0.2' },
            { id: 'pc2', kind: 'pc', label: 'PC2', x: 95, y: 0, note: '10.2.0.10' },
          ],
          links: [{ a: 'pc0', b: 'c' }, { a: 'c', b: 's', label: 'UDP 51820 · wg0' }, { a: 's', b: 'pc2' }],
        }, 'El laboratorio «VPN WireGuard: central y sucursal tras NAT»: la central tiene la dirección IP pública 81.32.5.2; la sucursal, tras el NAT de su operador, la llama y mantiene el NAT abierto con keepalive.'),
        h('Paso a paso'),
        steps(
          ['Genera las claves', 'En cada router, **Servicios → VPN → Generar claves**, o `wg genkey | tee private.key | wg pubkey`. Pasa la clave pública al otro extremo.'],
          ['La interfaz', 'Dirección del túnel (10.99.0.1/24 en la central, .2 en la sucursal), puerto 51820 y la clave privada.'],
          ['El par', 'La clave pública del otro y sus **AllowedIPs**: su dirección del túnel y su LAN (la central: 10.99.0.2/32, 10.2.0.0/24).'],
          ['El lado tras NAT llama', 'En la sucursal: **Endpoint** = dirección IP pública de la central:51820 y **PersistentKeepalive** = 25.'],
          ['Arranca', '**Guardar y aplicar**, o `systemctl enable --now wg-quick@wg0`. Abre UDP 51820 en input y deja pasar wg0 en forward.'],
        ),
        code('[Interface]\nAddress = 10.99.0.2/24\nListenPort = 51820\nPrivateKey = (clave privada de la sucursal)\n\n[Peer]\nPublicKey = (clave pública de la central)\nAllowedIPs = 10.99.0.0/24, 10.1.0.0/24\nEndpoint = 81.32.5.2:51820\nPersistentKeepalive = 25'),
        check('Compruébalo', '`wg show` debe tener **latest handshake** y tráfico en los dos sentidos; un traceroute de una LAN a la otra pasa por la dirección del túnel.'),
        term('shell', 'root@central:~# wg show\ninterface: wg0\n  public key: (clave pública de la central)\n  private key: (hidden)\n  listening port: 51820\n\npeer: (clave pública de la sucursal)\n  endpoint: 81.33.3.2:51820\n  allowed ips: 10.99.0.2/32, 10.2.0.0/24\n  latest handshake: 29 seconds ago\n  transfer: 212 B received, 92 B sent\nalumno@pc0:~$ traceroute -n 10.2.0.10\ntraceroute to 10.2.0.10 (10.2.0.10), 30 hops max, 60 byte packets\n 1  10.1.0.1  4.400 ms  4.211 ms  4.292 ms\n 2  10.99.0.2  28.319 ms  28.400 ms  28.211 ms\n 3  10.2.0.10  32.238 ms  32.319 ms  32.400 ms'),
        table(['Orden', 'Efecto'], [
          ['wg-quick up wg0 · down wg0', 'Levanta o quita el túnel según /etc/wireguard/wg0.conf.'],
          ['wg show · wg showconf wg0', 'Estado (handshake, bytes, endpoint) / configuración en uso.'],
          ['wg set wg0 peer CLAVE allowed-ips … endpoint IP:PUERTO', 'Cambia un par en marcha.'],
          ['ip a · ip route', 'wg0 aparece como interfaz POINTOPOINT y sus rutas «dev wg0».'],
        ]),
        note('PostUp/PostDown en wg0.conf se ejecutan con bash (%i es la interfaz), por ejemplo para añadir reglas nft. La masquerade solo debe aplicarse a la salida por eth0, no a wg0.'),
        warn('Errores habituales', 'Una clave pública equivocada: el handshake nunca termina y `wg show` no muestra «latest handshake». AllowedIPs sin la LAN del otro: el túnel sube pero no hay ruta hacia ella. Nadie con Endpoint cuando los dos están tras NAT: ninguno puede empezar. UDP 51820 cerrado en el cortafuegos de la central.'),
        exercise('Sigue el túnel', 'En el laboratorio «VPN WireGuard: central y sucursal tras NAT», comprueba desde PC0 que llega a PC2 y por dónde pasa. ¿Desde qué dirección IP pública llama la sucursal?', '`traceroute -n 10.2.0.10` en PC0: 10.1.0.1 (CENTRAL), 10.99.0.2 (la sucursal por el túnel) y 10.2.0.10. En CENTRAL, `wg show` muestra el par con endpoint 81.33.3.2:51820: la dirección IP pública del router del operador de la sucursal, aprendida gracias al keepalive.'),
      ],
    },
  ],
};
