/** Documentación: NAT, ACL e IPsec en el router IOS, en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/glopezca/netfix/blob/main/';

export const IOS_SEC_DOCS: readonly DocPage[] = [
  {
    id: 'ios-nat',
    title: 'NAT y ACL estándar',
    summary: 'Salir a Internet con una sola dirección IP pública: ip nat inside/outside, PAT con overload, NAT estático y ACL estándar.',
    markdownBase: MD,
    blocks: [
      p('Las direcciones IP privadas (192.168.x.x, 10.x.x.x, 172.16-31.x.x) no se enrutan en Internet. Con **NAT** el router cambia la dirección IP de origen de cada paquete que sale por la suya pública, y la de destino de la respuesta por la del PC. Con **PAT** (overload) toda la red sale con una sola dirección IP pública: el router distingue cada conversación por el puerto.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'pc1', kind: 'pc', label: 'PC1', x: 5, y: 0, note: '192.168.10.11' },
          { id: 'r', kind: 'router', label: 'SEDE1', x: 40, y: 0, note: 'inside .1 · outside 81.32.5.2' },
          { id: 'isp', kind: 'cloud', label: 'ISP-Norte', x: 80, y: 0 },
        ],
        links: [{ a: 'pc1', b: 'r', label: 'g0/0 inside' }, { a: 'r', b: 'isp', label: 'g0/1 outside' }],
      }, 'En el laboratorio «Internet: dos sedes y DNS públicos», todo lo que sale de la LAN de la sede 1 lleva como origen 81.32.5.2.'),
      h('Paso a paso: PAT'),
      steps(
        ['Marca el lado de dentro', '`interface g0/0` y `ip nat inside`: la LAN.'],
        ['Marca el lado de fuera', '`interface g0/1` y `ip nat outside`: la línea del operador (aquí con `ip address dhcp`).'],
        ['Di qué se traduce', 'Una ACL estándar con la red de dentro: `access-list 1 permit 192.168.10.0 0.0.0.255` (máscara wildcard: los 0 deben coincidir).'],
        ['Activa la traducción', '`ip nat inside source list 1 interface GigabitEthernet0/1 overload`.'],
      ),
      code('SEDE1(config)# interface g0/0\nSEDE1(config-if)# ip nat inside\nSEDE1(config-if)# interface g0/1\nSEDE1(config-if)# ip address dhcp\nSEDE1(config-if)# ip nat outside\nSEDE1(config-if)# exit\nSEDE1(config)# access-list 1 permit 192.168.10.0 0.0.0.255\nSEDE1(config)# ip nat inside source list 1 interface GigabitEthernet0/1 overload'),
      check('Compruébalo', 'Tras navegar desde un PC, `show ip nat translations` muestra una línea por conversación: **Inside local** es el PC y **Inside global**, la dirección IP pública con el puerto que el router le asignó.'),
      term('ios', 'SEDE1#show ip nat translations\nPro  Inside global         Inside local          Outside local         Outside global\nudp  81.32.5.2:50700       192.168.10.11:50700   8.8.8.8:53            8.8.8.8:53\ntcp  81.32.5.2:49152       192.168.10.11:49152   81.33.3.2:80          81.33.3.2:80\nicmp 81.32.5.2:1           192.168.10.11:1       8.8.8.8:1             8.8.8.8:1\nSEDE1#show ip nat statistics\nTotal active translations: 3 (0 static, 3 dynamic; 3 extended)\nOutside interfaces:\n  GigabitEthernet0/1\nInside interfaces:\n  GigabitEthernet0/0'),
      h('Todas las órdenes'),
      table(['Orden', 'Uso'], [
        ['ip nat inside | outside', 'Marca la interfaz (también subinterfaces).'],
        ['access-list N permit|deny any | host A | A WILDCARD', 'ACL estándar numerada (1-99). remark para comentarios.'],
        ['ip access-list standard NOMBRE', 'ACL estándar con nombre: (config-std-nacl)# [secuencia] permit|deny …'],
        ['ip nat pool NOMBRE INICIO FIN netmask M | prefix-length N', 'Rango de direcciones IP globales.'],
        ['ip nat inside source list ACL interface IF overload', 'PAT: todas las direcciones permitidas salen con la dirección IP de la interfaz.'],
        ['ip nat inside source list ACL pool NOMBRE [overload]', 'NAT dinámico 1:1 (o PAT sobre el pool).'],
        ['ip nat inside source static LOCAL GLOBAL', 'NAT estático 1:1 (el router responde ARP por GLOBAL).'],
        ['ip nat inside source static tcp|udp LOCAL P GLOBAL|interface IF P', 'Publica un puerto de un servidor interno.'],
        ['show ip nat translations · show ip nat statistics', 'Traducciones activas y contadores.'],
        ['clear ip nat translation * · debug ip nat', 'Borra las traducciones dinámicas · una línea por paquete traducido.'],
      ]),
      tip('Publicar un servidor', 'Para que desde Internet se llegue a un servidor de la LAN: `ip nat inside source static tcp 192.168.10.5 80 interface GigabitEthernet0/1 80`. Las peticiones al puerto 80 de la dirección IP pública van a 192.168.10.5.'),
      warn('Errores habituales', 'Intercambiar inside y outside. Una ACL que no incluye la red de los PC (o una wildcard escrita como máscara, 255.255.255.0): no se traduce nada. Los paquetes que no coinciden salen sin traducir y el otro extremo no sabe volver a una red privada.'),
      exercise('¿Con qué dirección IP sale PC1?', 'En el laboratorio «Internet: dos sedes y DNS públicos», abre http://www.sede2.es desde PC1 y averigua en SEDE1 con qué dirección IP y puerto salió esa conexión.', '`show ip nat translations` en SEDE1: la línea tcp con Outside 81.33.3.2:80 tiene Inside local 192.168.10.11:49152 e Inside global 81.32.5.2:49152. La web de la sede 2 solo ve 81.32.5.2, la dirección IP que el operador dio a g0/1 (`show ip interface brief`: método DHCP).'),
    ],
  },
  {
    id: 'ios-acl',
    title: 'ACL extendidas',
    summary: 'Filtrar por protocolo, origen, destino y puerto: escribir la lista, aplicarla en el sentido correcto y leer sus contadores.',
    markdownBase: MD,
    blocks: [
      p('Una **ACL extendida** decide qué tráfico pasa por una interfaz según protocolo, origen, destino y puertos. Las entradas se recorren **en orden** y gana la primera que coincide; al final hay un **deny any implícito**: lo que no se permite, se descarta.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'admin', kind: 'pc', label: 'ADMIN', x: 0, y: 0, note: '192.168.10.10' },
          { id: 'alumno', kind: 'pc', label: 'ALUMNO', x: 80, y: 0, note: '192.168.20.10' },
          { id: 'gw', kind: 'router', label: 'GW', x: 40, y: 15 },
          { id: 'srv', kind: 'server', label: 'SRV-INTRANET', x: 40, y: 45, note: '172.20.0.10' },
        ],
        links: [{ a: 'admin', b: 'gw', label: 'g0/0' }, { a: 'alumno', b: 'gw', label: 'g0/1' }, { a: 'gw', b: 'srv', label: 'g0/2 · A-SERVIDORES out' }],
      }, 'El laboratorio «Bastionado: ACL, nftables y sshd»: la web es para todos; SSH y ping, solo desde administración.'),
      h('Paso a paso'),
      steps(
        ['Escribe la regla en palabras', '«La web del servidor, para todos; SSH y ping, solo desde 192.168.10.0/24; lo demás, no».'],
        ['Crea la lista', '`ip access-list extended A-SERVIDORES` y una entrada por regla, de la más concreta a la más general.'],
        ['Elige interfaz y sentido', 'Lo más cerca posible del destino: `interface g0/2` (la red de servidores) y `ip access-group A-SERVIDORES out`.'],
        ['Comprueba', 'Prueba desde cada red y mira `show access-lists`: cada entrada cuenta sus coincidencias.'],
      ),
      code('GW(config)# ip access-list extended A-SERVIDORES\nGW(config-ext-nacl)# permit tcp any host 172.20.0.10 eq www\nGW(config-ext-nacl)# permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\nGW(config-ext-nacl)# permit icmp 192.168.10.0 0.0.0.255 any\nGW(config-ext-nacl)# permit udp any host 172.20.0.10 eq domain\nGW(config-ext-nacl)# deny ip any any log\nGW(config-ext-nacl)# exit\nGW(config)# interface g0/2\nGW(config-if)# ip access-group A-SERVIDORES out'),
      check('Compruébalo', 'Tras probar la web, SSH y ping desde ADMIN y ALUMNO, los contadores dicen qué entrada decidió cada caso. Con `log`, cada paquete descartado deja un aviso en la consola del router.'),
      term('ios', 'GW#show access-lists\nExtended IP access list A-SERVIDORES\n    20 permit tcp any host 172.20.0.10 eq www (3 match(es))\n    30 permit tcp 192.168.10.0 0.0.0.255 host 172.20.0.10 eq 22\n    40 permit icmp 192.168.10.0 0.0.0.255 any (2 match(es))\n    50 permit udp any host 172.20.0.10 eq domain\n    60 deny ip any any log (2 match(es))\n%SEC-6-IPACCESSLOGP: list A-SERVIDORES denied tcp 192.168.20.10(49153) -> 172.20.0.10(22), 1 packet'),
      table(['Elemento', 'Ejemplos'], [
        ['Protocolo', 'ip, tcp, udp, icmp, esp, gre'],
        ['Origen / destino', 'any · host 10.0.0.2 · 192.168.10.0 0.0.0.255 (wildcard)'],
        ['Puertos (tcp/udp)', 'eq www · eq 22 · gt 1023 · lt 1024 · neq 23 · range 50 60'],
        ['ICMP', 'echo · echo-reply · unreachable · time-exceeded'],
        ['Opciones', 'established (TCP con ACK o RST) · log (%SEC-6-IPACCESSLOGP)'],
      ]),
      list(
        'in filtra lo que entra por la interfaz antes de la NAT y del enrutamiento; out filtra lo que sale en tránsito (ni las respuestas que entran por esa interfaz ni el tráfico del propio router).',
        'Una ACL extendida también sirve para la NAT: deny ip LAN1 LAN2 deja ese tráfico sin traducir (exención para una VPN).',
        'clear access-list counters pone a cero los contadores.',
        'En ACL con nombre, «15 permit …» inserta con número de secuencia y «no 15» borra esa entrada.',
      ),
      warn('Errores habituales', 'Poner una entrada general antes que una concreta: la concreta nunca se usa. Olvidar el deny implícito: una lista con solo un deny lo bloquea todo. Aplicarla en el sentido equivocado (in en vez de out): no filtra lo que querías, o filtra las respuestas. Permitir TCP 22 sin pensar en la vuelta: con `out` en la red del servidor, las respuestas no pasan por esa lista.'),
      exercise('¿Por qué ALUMNO no entra por SSH?', 'En el laboratorio «Bastionado: ACL, nftables y sshd», `ssh admin@172.20.0.10` desde ALUMNO responde al momento «ssh: connect to host 172.20.0.10 port 22: No route to host», pero la web sí abre. ¿Qué entrada lo decide y de dónde sale ese mensaje?', 'La 30 solo permite SSH desde 192.168.10.0/24; ALUMNO es 192.168.20.10, así que llega a la 60 (`deny ip any any log`): la consola de GW muestra «%SEC-6-IPACCESSLOGP: list A-SERVIDORES denied tcp 192.168.20.10(…) -> 172.20.0.10(22)». GW contesta además con un ICMP «administratively prohibited», y el Linux de ALUMNO aborta la conexión: de ahí «No route to host» (un Windows lo ignora y acaba en «Connection timed out»). La web pasa por la 20 (`permit tcp any … eq www`), que suma coincidencias en `show access-lists`.'),
    ],
  },
  {
    id: 'ios-ipsec',
    title: 'VPN IPsec en el 2911',
    summary: 'Un túnel sitio a sitio paso a paso: política ISAKMP, clave, transform-set, ACL espejo y crypto map; y cómo comprobarlo.',
    markdownBase: MD,
    blocks: [
      p('Una **VPN IPsec sitio a sitio** une dos LAN a través de Internet como si estuvieran juntas, con el tráfico cifrado. **IKE** (UDP 500) negocia la política y comprueba la clave compartida sin enviarla; después **ESP** lleva los paquetes. Los primeros paquetes «interesantes» se pierden mientras sube el túnel.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'a', kind: 'router', label: 'SEDE-A', x: 10, y: 20, note: '81.32.5.2 · LAN 192.168.10.0/24' },
          { id: 'inet', kind: 'cloud', label: 'Internet', x: 45, y: 0 },
          { id: 'b', kind: 'router', label: 'SEDE-B', x: 80, y: 20, note: '81.33.5.2 · LAN 192.168.20.0/24' },
        ],
        links: [{ a: 'a', b: 'inet' }, { a: 'inet', b: 'b' }, { a: 'a', b: 'b', label: 'túnel ESP (lógico)' }],
      }, 'El laboratorio «VPN IPsec entre dos sedes (2911)»: cada sede protege el tráfico hacia la LAN de la otra.'),
      h('Paso a paso (en las dos sedes)'),
      steps(
        ['Política ISAKMP (fase 1)', '`crypto isakmp policy 10` con cifrado, hash, autenticación y grupo DH: `encryption aes 256`, `hash sha`, `authentication pre-share`, `group 5`.'],
        ['Clave compartida', '`crypto isakmp key Netfix-VPN-2026 address 81.33.5.2` (la dirección IP pública de la otra sede).'],
        ['Transform-set (fase 2)', '`crypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac`.'],
        ['Tráfico interesante', 'Una ACL extendida de tu LAN a la suya. En la otra sede, la misma al revés (ACL espejo).'],
        ['Crypto map', '`crypto map VPN 10 ipsec-isakmp` con `set peer`, `set transform-set` y `match address`, y aplícalo con `crypto map VPN` en la interfaz pública.'],
      ),
      code('crypto isakmp policy 10\n encryption aes 256\n hash sha\n authentication pre-share\n group 5\ncrypto isakmp key Netfix-VPN-2026 address 81.33.5.2\ncrypto ipsec transform-set TS-AES esp-aes 256 esp-sha-hmac\nip access-list extended VPN\n permit ip 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255\ncrypto map VPN 10 ipsec-isakmp\n set peer 81.33.5.2\n set transform-set TS-AES\n match address VPN\ninterface GigabitEthernet0/1\n crypto map VPN'),
      check('Compruébalo', 'Haz ping de una LAN a la otra: los primeros se pierden mientras se negocia. Después, la SA de IKE está en **QM_IDLE** y los contadores encaps/decaps suben.'),
      term('cmd', 'C:\\home\\alumno> ping -n 4 192.168.20.10\nPinging 192.168.20.10 with 32 bytes of data:\nRequest timed out.\nRequest timed out.\nReply from 192.168.20.10: bytes=32 time<1ms TTL=126\nReply from 192.168.20.10: bytes=32 time<1ms TTL=126'),
      term('ios', 'SEDE-A#show crypto isakmp sa\nIPv4 Crypto ISAKMP SA\ndst             src             state          conn-id status\n81.33.5.2       81.32.5.2       QM_IDLE           1001 ACTIVE\nSEDE-A#show crypto ipsec sa | include encaps|decaps\n   #pkts encaps: 3, #pkts encrypt: 3, #pkts digest: 3\n   #pkts decaps: 2, #pkts decrypt: 2, #pkts verify: 2'),
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
      warn('Errores habituales', 'Claves, políticas o transform-sets distintos en cada sede. ACL que no son espejo. Con NAT overload en la misma interfaz, el tráfico entre sedes se traduce antes de cifrarse: exclúyelo de la NAT con una ACL extendida (deny ip LAN1 LAN2 antes del permit). ESP no tiene puertos: atraviesa una NAT 1:1 pero una PAT lo descarta; usa direcciones IP públicas (línea «Dirección IP pública» de la nube ISP).'),
      note('El simulador no cifra los bytes: ESP transporta el paquete original, pero el comportamiento (negociación, SPI, contadores, errores) es el de IOS.'),
      exercise('Levanta el túnel', 'En el laboratorio «VPN IPsec entre dos sedes (2911)», haz que PC0 (sede A) llegue a PC2 (sede B) y comprueba en SEDE-A que el túnel está arriba.', 'En la Terminal Windows de PC0: `ping -n 4 192.168.20.10`: dos «Request timed out.» y dos respuestas. En SEDE-A, `show crypto isakmp sa` muestra 81.33.5.2 81.32.5.2 QM_IDLE ACTIVE, y `show crypto ipsec sa` cuenta los paquetes encapsulados y desencapsulados.'),
    ],
  },
];
