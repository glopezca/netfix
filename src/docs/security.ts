/** Documentación: seguridad y VPN (ACL extendidas, IPsec, router Linux, nftables, WireGuard, SFTP). */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const SECURITY_DOCS: DocGroup = {
  id: 'seguridad',
  title: 'Seguridad y VPN',
  pages: [
    {
      id: 'ios-acl',
      title: 'ACL extendidas',
      summary: 'access-list 100-199, ip access-list extended, puertos, established, log e ip access-group in|out.',
      blocks: [
        p('Una ACL extendida filtra por protocolo, origen, destino y puertos. Se aplica a una interfaz con ip access-group NOMBRE in|out. Las entradas se recorren en orden y al final hay un deny any implícito.'),
        code('Router(config)# ip access-list extended A-SERVIDORES\nRouter(config-ext-nacl)# permit tcp any host 172.20.0.10 eq www\nRouter(config-ext-nacl)# permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\nRouter(config-ext-nacl)# permit icmp 192.168.10.0 0.0.0.255 any\nRouter(config-ext-nacl)# deny ip any any log\nRouter(config-ext-nacl)# exit\nRouter(config)# interface g0/2\nRouter(config-if)# ip access-group A-SERVIDORES out'),
        table(['Elemento', 'Ejemplos'], [
          ['Protocolo', 'ip, tcp, udp, icmp, esp, gre'],
          ['Origen / destino', 'any · host 10.0.0.2 · 192.168.10.0 0.0.0.255 (wildcard)'],
          ['Puertos (tcp/udp)', 'eq www · eq 22 · gt 1023 · lt 1024 · neq 23 · range 50 60'],
          ['ICMP', 'echo · echo-reply · unreachable · time-exceeded'],
          ['Opciones', 'established (TCP con ACK o RST) · log (%SEC-6-IPACCESSLOGP)'],
        ]),
        list(
          'in filtra lo que entra por la interfaz antes de la NAT y del enrutamiento; out filtra lo que sale en tránsito.',
          'Una ACL extendida también sirve para la NAT: deny ip LAN1 LAN2 deja ese tráfico sin traducir (exención para una VPN).',
          'show access-lists muestra cada entrada con sus «(N match(es))»; clear access-list counters los pone a cero.',
          'En ACL con nombre, «15 permit …» inserta con número de secuencia y «no 15» borra esa entrada.',
        ),
      ],
    },
    {
      id: 'ios-ipsec',
      title: 'VPN IPsec en el 2911',
      summary: 'crypto isakmp policy, crypto isakmp key, transform-set, crypto map, show crypto isakmp sa / ipsec sa.',
      blocks: [
        p('Un túnel IPsec sitio a sitio cifra el tráfico entre dos LAN a través de Internet. IKE (UDP 500) negocia la política y comprueba la clave compartida sin enviarla; después ESP lleva los paquetes. El primer paquete «interesante» se pierde mientras sube el túnel.'),
        code('crypto isakmp policy 10\n encryption aes 256\n hash sha\n authentication pre-share\n group 5\ncrypto isakmp key Netfix-VPN-2026 address 203.0.113.2\ncrypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac\nip access-list extended VPN\n permit ip 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255\ncrypto map VPN 10 ipsec-isakmp\n set peer 203.0.113.2\n set transform-set TS-AES\n match address VPN\ninterface GigabitEthernet0/1\n crypto map VPN'),
        list(
          'Las dos sedes necesitan políticas ISAKMP iguales, la misma clave, transform-sets iguales y ACL espejo (origen y destino intercambiados).',
          'Con NAT overload en la misma interfaz, excluye el tráfico entre sedes de la NAT con una ACL extendida (deny ip LAN1 LAN2 antes del permit).',
          'ESP no tiene puertos: atraviesa una NAT 1:1 pero una PAT lo descarta. Usa IP públicas (línea «IP pública» de la nube ISP).',
        ),
        table(['Orden', 'Qué muestra'], [
          ['show crypto isakmp sa', 'La SA de IKE: QM_IDLE cuando está lista, MM_NO_STATE si falla.'],
          ['show crypto ipsec sa', 'Identidades protegidas, pares, SPI y contadores #pkts encaps/decaps y #send errors.'],
          ['show crypto map · show crypto isakmp policy', 'La configuración en uso.'],
          ['clear crypto sa · clear crypto isakmp', 'Borra las SA: el siguiente paquete vuelve a negociar.'],
        ]),
        table(['Mensaje', 'Causa'], [
          ['%CRYPTO-4-IKMP_BAD_MESSAGE', 'La clave compartida no coincide.'],
          ['%CRYPTO-6-IKMP_MODE_FAILURE … Main mode', 'Ninguna política ISAKMP coincide.'],
          ['%CRYPTO-6-IKMP_MODE_FAILURE … Quick mode', 'Transform-set o ACL espejo distintos.'],
          ['%CRYPTO-4-RECVD_PKT_NOT_IPSEC', 'Llega en claro tráfico que el túnel debería proteger.'],
        ]),
        note('El simulador no cifra los bytes: ESP transporta el paquete original, pero el comportamiento (negociación, SPI, contadores, errores) es el de IOS.'),
      ],
    },
    {
      id: 'linux-router',
      title: 'Router Linux',
      summary: 'Hardware de un 2911 con Ubuntu: eth0-eth2, ip_forward, rutas, NAT con nftables y gestión web.',
      blocks: [
        p('El Router Linux tiene los puertos de un 2911 (GigabitEthernet0/0-2) y el software de Server: los puertos se llaman eth0, eth1 y eth2 en la terminal. Solo reenvía paquetes entre interfaces si net.ipv4.ip_forward = 1.'),
        code('root@linuxrouter0:~# ip addr add 192.168.1.1/24 dev eth1\nroot@linuxrouter0:~# ip route add 10.20.0.0/16 via 192.168.1.254\nroot@linuxrouter0:~# sysctl -w net.ipv4.ip_forward=1\nroot@linuxrouter0:~# echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-router.conf'),
        table(['Dónde', 'Qué se configura'], [
          ['Pestaña Interfaces', 'Dirección de cada eth, DHCP en eth0, rutas estáticas y reenvío.'],
          ['Servicios → Cortafuegos y sysctl', 'nftables (tablas, cadenas, reglas, plantillas) y parámetros del núcleo; se aplica y se guarda.'],
          ['Servicios → VPN', 'Túnel WireGuard wg0.'],
          ['Gestión web (Seguridad)', 'Las mismas opciones en páginas al estilo WRT300N.'],
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
          ['sudo nft add rule inet filter input tcp dport 80 accept', 'Añade una regla al final (insert: al principio).'],
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
    {
      id: 'srv-sftp',
      title: 'SFTP y scp',
      summary: 'Subsistema sftp de sshd, sftp interactivo y por lotes, scp, y las apps Cliente SSH y Archivos (SFTP) del PC.',
      blocks: [
        p('sftp y scp usan la misma conexión SSH (contraseña o par de claves) y el subsistema «Subsystem sftp …» de sshd_config. Cada operación se hace con los permisos del usuario en el servidor: sin permiso de escritura, «Permission denied».'),
        code('alumno@pc0:~$ sftp ana@srv.aula.lab\nConnected to srv.aula.lab.\nsftp> put tarea.txt\nUploading tarea.txt to /home/ana/tarea.txt\nsftp> ls -l\nsftp> get bienvenida.txt\nsftp> bye\nalumno@pc0:~$ scp informe.txt ana@srv.aula.lab:entregas/\nalumno@pc0:~$ scp ana@srv.aula.lab:/etc/hostname .'),
        table(['Orden de sftp', 'Efecto'], [
          ['ls [-la] · cd · pwd', 'En el servidor.'],
          ['lls · lcd · lpwd · lmkdir', 'En el equipo local.'],
          ['get REMOTO [LOCAL] · put LOCAL [REMOTO]', 'Descargar / subir.'],
          ['mkdir · rmdir · rm · rename · chmod 640 FICHERO', 'Gestión de ficheros remotos.'],
          ['sftp -b lote usuario@host', 'Ejecuta las órdenes de un fichero (implica BatchMode: hace falta par de claves).'],
        ]),
        h('Apps del PC'),
        list(
          'Cliente SSH (como PuTTY): sesiones guardadas, una terminal por sesión, generación de pares de claves y lista de hosts conocidos con su huella.',
          'Archivos (SFTP) (como FileZilla): conexión rápida, panel local y remoto, subir, descargar, nueva carpeta, renombrar y borrar; pregunta por la huella del servidor la primera vez.',
        ),
        note('Si quitas la línea Subsystem de sshd_config y recargas ssh, sftp y scp fallan con «subsystem request failed on channel 0», pero ssh sigue funcionando.'),
      ],
    },
  ],
};
