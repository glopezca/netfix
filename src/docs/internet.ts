/** Documentación: nube ISP, Internet emulada, DNS públicos, NAT de IOS, gestión web de IOS y traceroute. */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const INTERNET_DOCS: DocGroup = {
  id: 'internet',
  title: 'Internet y NAT',
  pages: [
    {
      id: 'inet-cloud',
      title: 'Nube ISP',
      summary: 'Líneas de cable, xDSL y fibra: IP pública por DHCP o router del operador con NAT y redirección de puertos.',
      blocks: [
        p('La Nube (paleta → Nube) emula la salida a Internet de un proveedor. Tiene seis puertos, uno por línea de cliente: Coaxial0-1 (cable DOCSIS), DSL0-1 (VDSL2) y Fibra0-1 (FTTH). Conecta a cada uno un router (GigabitEthernet), un switch o un PC.'),
        table(['Modo de la línea', 'Qué hace', 'Cuándo usarlo'], [
          ['Router del operador (por defecto)', 'Es el router de casa: LAN 192.168.1.1/24, DHCP desde .33 (DNS 8.8.8.8 y 8.8.4.4), NAT de toda la LAN a la IP pública x.y.n.2 y redirección de puertos.', 'Conectar PCs, un switch o un servidor directamente.'],
          ['IP pública (/29)', 'La nube es la puerta de enlace x.y.n.1/29 y entrega por DHCP x.y.n.2 a tu router; .3-.6 quedan libres para NAT estático.', 'Configurar el NAT tú mismo en un Cisco 2911 (ip address dhcp + ip nat).'],
        ]),
        h('Direcciones'),
        list(
          'Cada nube tiene un bloque público /16 propio (la primera 81.32.0.0, la segunda 81.33.0.0…). El puerto número i (Coaxial0 = 1, Coaxial1 = 2, DSL0 = 3, DSL1 = 4, Fibra0 = 5, Fibra1 = 6) usa x.y.i.0/29.',
          'El router del ISP en la red troncal es x.y.0.1 y aparece en traceroute.',
          'Cada línea tiene su propio plano IP: varias líneas pueden usar 192.168.1.0/24 a la vez.',
        ),
        h('Ventana de la nube'),
        list(
          'ISP: nombre del proveedor, bloque público y dominios registrados.',
          'Líneas: modo, velocidades contratadas (informativas), IP y máscara de la LAN, concesiones DHCP, traducciones NAT y redirección de puertos (TCP o UDP, puerto público → IP:puerto de la LAN).',
        ),
        note('Sin redirecciones, desde Internet solo responde el propio router (ping a la WAN); cualquier otro puerto devuelve RST: curl dice «Connection refused».'),
      ],
    },
    {
      id: 'inet-dns',
      title: 'Internet emulada y DNS públicos',
      summary: 'Routers troncales, 8.8.8.8/8.8.4.4, webs de prueba, dominios registrados y delegación NS.',
      blocks: [
        p('Todas las nubes del área de trabajo están unidas por una Internet emulada: el router de cada ISP, dos routers troncales (198.51.100.1 y 198.51.100.2) y los servidores de destino. Cada salto resta 1 al TTL y responde «tiempo excedido», así que traceroute y tracert muestran la ruta.'),
        table(['Servidor', 'Dirección', 'Uso'], [
          ['dns.google', '8.8.8.8 · 8.8.4.4', 'DNS recursivo público (UDP 53). También responde a ping.'],
          ['www.google.com', '142.250.184.4', 'Web de prueba: muestra tu IP pública.'],
          ['example.com', '93.184.215.14', 'Web de prueba.'],
          ['ifconfig.me', '34.160.111.145', 'Devuelve solo tu IP pública en texto (curl ifconfig.me).'],
        ]),
        h('Dominios registrados en un ISP'),
        p('En la pestaña ISP de una nube puedes registrar dominios. Los DNS públicos los resuelven para todas las nubes:'),
        table(['Tipo', 'Respuesta de 8.8.8.8'], [
          ['A', 'El dominio y cualquier nombre bajo él (*.dominio) apuntan a la IP indicada.'],
          ['NS (delegación)', '8.8.8.8 pregunta al servidor DNS de esa IP y reenvía su respuesta: tu Server-PT es el autoritativo de la zona.'],
        ]),
        h('Ejemplo: publicar la web de una sede'),
        code('Nube ISP-Sur → Líneas → DSL0 (router del operador, WAN 81.33.3.2)\n  Redirección TCP 80 → 192.168.1.10:80 y UDP 53 → 192.168.1.10:53\nNube ISP-Sur → ISP → dominio sede2.es, tipo NS, IP 81.33.3.2\nSRV-SEDE2 (192.168.1.10) → DNS: zona sede2.es con www → 81.33.3.2\nPC de otra sede:  host www.sede2.es  ·  navegador http://www.sede2.es'),
        note('El laboratorio «Internet: dos sedes y DNS públicos» trae todo esto montado.'),
        p('En modo simulación los paquetes que cruzan Internet aparecen como eventos entre las nubes (puerto «Internet»).'),
      ],
    },
    {
      id: 'ios-nat',
      title: 'NAT y ACL estándar (IOS)',
      summary: 'ip nat inside/outside, PAT con overload, pools, NAT estático con puertos y listas de acceso estándar.',
      blocks: [
        code('R1(config)# interface g0/0\nR1(config-if)# ip nat inside\nR1(config-if)# interface g0/1\nR1(config-if)# ip address dhcp\nR1(config-if)# ip nat outside\nR1(config-if)# exit\nR1(config)# access-list 1 permit 192.168.10.0 0.0.0.255\nR1(config)# ip nat inside source list 1 interface GigabitEthernet0/1 overload'),
        table(['Orden', 'Uso'], [
          ['ip nat inside | outside', 'Marca la interfaz (también subinterfaces).'],
          ['access-list N permit|deny any | host A | A WILDCARD', 'ACL estándar numerada (1-99). remark para comentarios.'],
          ['ip access-list standard NOMBRE', 'ACL estándar con nombre: (config-std-nacl)# [secuencia] permit|deny …'],
          ['ip nat pool NOMBRE INICIO FIN netmask M | prefix-length N', 'Rango de direcciones globales.'],
          ['ip nat inside source list ACL interface IF overload', 'PAT: todas las direcciones permitidas salen con la IP de la interfaz.'],
          ['ip nat inside source list ACL pool NOMBRE [overload]', 'NAT dinámico 1:1 (o PAT sobre el pool).'],
          ['ip nat inside source static LOCAL GLOBAL', 'NAT estático 1:1 (el router responde ARP por GLOBAL).'],
          ['ip nat inside source static tcp|udp LOCAL P GLOBAL|interface IF P', 'Publica un puerto de un servidor interno.'],
        ]),
        h('Comprobación'),
        table(['Orden', 'Muestra'], [
          ['show ip nat translations', 'Pro, Inside global, Inside local, Outside local, Outside global.'],
          ['show ip nat statistics', 'Traducciones activas, interfaces, aciertos/fallos y reglas dinámicas con sus pools.'],
          ['show access-lists', 'Entradas de cada lista y coincidencias.'],
          ['clear ip nat translation *', 'Borra las traducciones dinámicas.'],
          ['debug ip nat', 'NAT: s=192.168.10.10->81.32.5.2, d=8.8.8.8 [n] por cada paquete traducido.'],
        ]),
        note('Los paquetes que no coinciden con ninguna regla salen sin traducir (como en IOS): sin NAT, el otro extremo no sabe volver a una red privada.'),
      ],
    },
    {
      id: 'ios-web',
      title: 'Gestión web de routers y switches',
      summary: 'ip http server, puerto, autenticación enable o local, usuarios y páginas del servidor HTTP de IOS.',
      blocks: [
        p('Routers 2911 y switches 2960 (en una SVI, interface Vlan1) tienen el servidor HTTP de IOS. Se activa en la CLI o en la pestaña «Gestión web» de su ventana (casilla, puerto y usuarios).'),
        code('Router(config)# ip http server\nRouter(config)# ip http port 8080\nRouter(config)# ip http authentication local\nRouter(config)# username admin privilege 15 secret cisco'),
        table(['Orden', 'Uso'], [
          ['ip http server', 'Escucha en el puerto 80 (o el de ip http port).'],
          ['ip http port N', 'Cambia el puerto (1-65535).'],
          ['ip http authentication enable', 'Por defecto: cualquier usuario con la contraseña de enable secret/password. Sin enable secret nadie entra.'],
          ['ip http authentication local', 'Usuarios de username; su privilegio decide el nivel (15 = todo).'],
          ['username U [privilege N] secret|password CLAVE', 'Usuario local (secret se guarda como hash tipo 5).'],
        ]),
        h('Páginas'),
        table(['URL', 'Contenido'], [
          ['/', 'Inicio: «Accessing Cisco … "R1"» con enlaces.'],
          ['/level/15/exec/-/show/ip/interface/brief/CR', 'Ejecuta una orden EXEC (las palabras separadas por /, CR al final).'],
          ['/level/N/exec/-', 'Monitor: palabras clave posibles como enlaces y cuadro Command (nivel 1 = EXEC de usuario).'],
          ['/level/15/configure/-', 'Configure: órdenes de configuración, una por línea.'],
          ['/level/15/dm', 'Device Manager: panel frontal, tabla de interfaces y ajustes rápidos de puerto (descripción, estado, VLAN de acceso, IP).'],
        ]),
        note('La autenticación es HTTP Basic (realm level_15_access). Los fallos se registran como %SEC_LOGIN-4-LOGIN_FAILED y los cambios como %SYS-5-CONFIG_I … on vty0 (IP del PC). También funciona curl -u usuario:clave.'),
      ],
    },
    {
      id: 'inet-trace',
      title: 'traceroute y tracert',
      summary: 'Ruta salto a salto en GNU/Linux, Windows e IOS.',
      blocks: [
        table(['Equipo', 'Orden', 'Opciones'], [
          ['GNU/Linux', 'traceroute DESTINO', '-n (sin nombres), -m SALTOS (30 por defecto)'],
          ['Windows', 'tracert DESTINO', '-h SALTOS, -d'],
          ['Router Cisco', 'traceroute A.B.C.D', '—'],
        ]),
        p('Las tres envían eco ICMP con TTL 1, 2, 3… (como traceroute -I): cada router del camino responde «tiempo excedido» y el destino responde al eco. Los saltos que no responden aparecen con *.'),
        code('$ traceroute -n 8.8.8.8\ntraceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets\n 1  192.168.1.1  2.400 ms  2.211 ms  2.292 ms\n 2  81.32.0.1  6.319 ms  6.400 ms  6.211 ms\n 3  198.51.100.1  …'),
      ],
    },
  ],
};
