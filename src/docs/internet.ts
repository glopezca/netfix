/** Documentación: nube ISP e Internet emulada (en estilo guiado), difusiones y traceroute. */
import type { DocGroup } from './types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/glopezca/netfix/blob/main/';

export const INTERNET_DOCS: DocGroup = {
  id: 'internet',
  title: 'Internet y NAT',
  pages: [
    {
      id: 'inet-cloud',
      title: 'Nube ISP',
      summary: 'La salida a Internet de un operador: líneas de cable, xDSL y fibra, modo router del operador o dirección IP pública, y redirección de puertos.',
      markdownBase: MD,
      blocks: [
        p('La **Nube** (paleta → Nube) es un **proveedor de Internet**: cada uno de sus seis puertos es una línea de cliente, como la que llega a una casa o a una empresa. Coaxial0-1 (cable DOCSIS), DSL0-1 (VDSL2) y Fibra0-1 (FTTH). A cada línea se conecta un router (GigabitEthernet), un switch o un PC.'),
        figure({
          type: 'topology',
          nodes: [
            { id: 'norte', kind: 'cloud', label: 'ISP-Norte', x: 15, y: 0 },
            { id: 'sur', kind: 'cloud', label: 'ISP-Sur', x: 70, y: 0 },
            { id: 'sede1', kind: 'router', label: 'SEDE1', x: 15, y: 25, note: 'Fibra0 · dirección IP pública' },
            { id: 'sw', kind: 'switch', label: 'Switch1', x: 70, y: 25, note: 'DSL0 · router del operador' },
            { id: 'srv', kind: 'server', label: 'SRV-SEDE2', x: 85, y: 50, note: '192.168.1.10' },
          ],
          links: [{ a: 'norte', b: 'sur', label: 'Internet' }, { a: 'norte', b: 'sede1' }, { a: 'sur', b: 'sw' }, { a: 'sw', b: 'srv' }],
        }, 'El laboratorio «Internet: dos sedes y DNS públicos»: la sede 1 tiene su propio router con NAT; la sede 2 usa el router del operador y le pide que redirija la web.'),
        h('Los dos modos de una línea'),
        table(['Modo de la línea', 'Qué hace', 'Cuándo usarlo'], [
          ['Router del operador (por defecto)', 'Es el router de casa: LAN 192.168.1.1/24, DHCP desde .33 (DNS 8.8.8.8 y 8.8.4.4), NAT de toda la LAN a la dirección IP pública x.y.n.2 y redirección de puertos.', 'Conectar PCs, un switch o un servidor directamente.'],
          ['Dirección IP pública (/29)', 'La nube es la puerta de enlace x.y.n.1/29 y entrega por DHCP x.y.n.2 a tu router; .3-.6 quedan libres para NAT estático.', 'Configurar el NAT tú mismo en un Cisco 2911 o en un router Linux.'],
        ]),
        h('Paso a paso: publicar un servidor detrás del router del operador'),
        steps(
          ['Conecta la línea', 'Un cable de DSL0 (por ejemplo) al switch de la sede; los equipos reciben 192.168.1.x por DHCP.'],
          ['Fija la dirección IP del servidor', 'El servidor necesita una dirección IP estática de la LAN (192.168.1.10) para que la redirección no cambie.'],
          ['Redirige el puerto', 'Doble clic en la nube → **Líneas** → DSL0 → **Redirección de puertos (NAT)**: TCP 80 → 192.168.1.10:80.'],
          ['Pruébalo desde fuera', 'Desde otra sede, `curl http://81.33.3.2/` (la dirección IP pública de la línea) debe devolver la web.'],
        ),
        check('Compruébalo', '`curl ifconfig.me` dice con qué dirección IP pública sale cada equipo a Internet: todos los de una línea comparten la de esa línea.'),
        term('shell', 'alumno@pc1:~$ curl -s ifconfig.me\n81.32.5.2\nadmin@srv-sede2:~$ curl -s ifconfig.me\n81.33.3.2\nalumno@pc1:~$ curl http://81.33.3.2:8080/\ncurl: (7) Failed to connect to 81.33.3.2 port 8080 after 0 ms: Couldn\'t connect to server'),
        h('Direcciones'),
        list(
          'Cada nube tiene un bloque público /16 propio (la primera 81.32.0.0, la segunda 81.33.0.0…). El puerto número i (Coaxial0 = 1, Coaxial1 = 2, DSL0 = 3, DSL1 = 4, Fibra0 = 5, Fibra1 = 6) usa x.y.i.0/29.',
          'El router del ISP en la red troncal es x.y.0.1 y aparece en traceroute.',
          'Cada línea tiene su propio plano IP: varias líneas pueden usar 192.168.1.0/24 a la vez.',
        ),
        table(['Pestaña de la nube', 'Qué tiene'], [
          ['ISP', 'Nombre del proveedor, bloque público y dominios registrados.'],
          ['Líneas', 'Por línea: modo, velocidades contratadas (informativas), dirección IP y máscara de la LAN, concesiones DHCP, traducciones NAT y redirección de puertos (TCP o UDP, puerto público → dirección IP:puerto de la LAN).'],
        ]),
        warn('Errores habituales', 'Sin redirección, desde Internet solo responde el propio router (ping a la dirección IP pública); cualquier otro puerto se rechaza y curl dice «Couldn\'t connect to server». Redirigir a un servidor con dirección IP por DHCP: si cambia, la redirección apunta a otro equipo. Conectar un router en modo «Router del operador»: tendrás doble NAT.'),
        exercise('¿Con qué dirección IP sale cada sede?', 'En el laboratorio «Internet: dos sedes y DNS públicos», averigua con qué dirección IP pública sale PC1 (sede 1) y con cuál SRV-SEDE2 (sede 2). ¿Qué línea y modo tiene cada una?', '`curl -s ifconfig.me`: PC1 sale con 81.32.5.2 (ISP-Norte, Fibra0 = puerto 5, modo Dirección IP pública: es la que SEDE1 recibe por DHCP en g0/1) y SRV-SEDE2 con 81.33.3.2 (ISP-Sur, DSL0 = puerto 3, modo Router del operador: el NAT lo hace la nube).'),
      ],
    },
    {
      id: 'inet-dns',
      title: 'Internet emulada y DNS públicos',
      summary: 'Routers troncales, 8.8.8.8, webs de prueba, nombres públicos, dominios registrados y delegación NS a tu propio servidor.',
      markdownBase: MD,
      blocks: [
        p('Todas las nubes del área de trabajo están unidas por una **Internet emulada**: el router de cada ISP, dos routers troncales (198.51.100.1 y 198.51.100.2) y los servidores de destino. Cada salto resta 1 al TTL y responde «tiempo excedido», así que traceroute y tracert muestran la ruta.'),
        term('shell', 'alumno@pc1:~$ traceroute -n 8.8.8.8\ntraceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets\n 1  192.168.10.1  4.400 ms  4.211 ms  4.292 ms\n 2  81.32.5.1  6.319 ms  6.400 ms  6.211 ms\n 3  81.32.0.1  10.238 ms  10.319 ms  10.400 ms\n 4  198.51.100.1  14.427 ms  14.238 ms  14.319 ms\n 5  198.51.100.2  14.346 ms  14.427 ms  14.238 ms\n 6  142.250.0.1  16.265 ms  16.346 ms  16.427 ms\n 7  8.8.8.8  26.454 ms  26.265 ms  26.346 ms'),
        table(['Salto', 'Quién es'], [
          ['1', 'La puerta de enlace de la LAN (SEDE1).'],
          ['2', 'El router de la línea en la nube (x.y.n.1).'],
          ['3', 'El router del ISP en la red troncal (x.y.0.1).'],
          ['4-5', 'Los routers troncales de Internet.'],
          ['6-7', 'La red del destino y el destino.'],
        ]),
        table(['Servidor', 'Dirección IP', 'Uso'], [
          ['dns.google', '8.8.8.8 · 8.8.4.4', 'DNS recursivo público (UDP 53). También responde a ping.'],
          ['www.google.com', '142.250.184.4', 'Web de prueba: muestra tu dirección IP pública.'],
          ['example.com', '93.184.215.14', 'Web de prueba.'],
          ['ifconfig.me', '34.160.111.145', 'Devuelve solo tu dirección IP pública en texto (curl ifconfig.me).'],
        ]),
        p('Además conoce unos 120 **nombres públicos**: los anteriores, google.es, educa.jcyl.es, juandecolonia.es y los 100 dominios más visitados del mundo (Similarweb y Semrush, 2026), sin webs para adultos ni de apuestas. Cada uno tiene su www, se resuelve por 8.8.8.8 y por iteración desde la raíz, y su dirección IP responde a ping y a HTTP. Las direcciones IP son representativas de las reales: las webs grandes responden desde muchas direcciones que cambian.'),
        tip('Sin salida a Internet', 'El servidor DNS de un Server o de un router Linux puede ofrecer la misma lista sin conexión: Servicios → DNS → Nombres públicos.'),
        h('Paso a paso: tu dominio en Internet'),
        p('En la pestaña **ISP** de una nube puedes registrar dominios, y los DNS públicos los resuelven para todas las nubes. Con un registro **NS** (delegación), 8.8.8.8 pregunta a tu propio servidor: tú eres el autoritativo de la zona.'),
        steps(
          ['Publica el DNS de tu servidor', 'En la línea de la sede, redirige **UDP 53** (y TCP 80 para la web) a la dirección IP del servidor.'],
          ['Crea la zona', 'En el servidor, **Servicios → DNS**: zona sede2.es con www y srv apuntando a la dirección IP **pública** (81.33.3.2), que es la que verán los de fuera.'],
          ['Registra el dominio', 'Nube → **ISP** → **Dominios registrados**: sede2.es, tipo **NS**, dirección IP 81.33.3.2.'],
          ['Pruébalo desde otra sede', '`host www.sede2.es` y el navegador con http://www.sede2.es.'],
        ),
        table(['Tipo de registro en el ISP', 'Respuesta de 8.8.8.8'], [
          ['A', 'El dominio y cualquier nombre bajo él (*.dominio) apuntan a la dirección IP indicada.'],
          ['NS (delegación)', '8.8.8.8 pregunta al servidor DNS de esa dirección IP y reenvía su respuesta.'],
        ]),
        check('Compruébalo', 'Desde la otra sede, el nombre resuelve con los datos de tu zona (el alias www → srv viene de tu servidor) y la web abre.'),
        term('shell', 'alumno@pc1:~$ host www.sede2.es\nwww.sede2.es is an alias for srv.sede2.es.\nsrv.sede2.es has address 81.33.3.2\nalumno@pc1:~$ curl -sI http://www.sede2.es | head -1\nHTTP/1.1 200 OK'),
        warn('Errores habituales', 'Poner en la zona la dirección IP privada del servidor (192.168.1.10): desde fuera no se llega. Olvidar redirigir UDP 53: 8.8.8.8 no obtiene respuesta y el nombre no resuelve. Registrar el dominio tipo A cuando querías gestionar tú la zona.'),
        note('En modo simulación los paquetes que cruzan Internet aparecen como eventos entre las nubes (puerto «Internet»).'),
        exercise('Sigue a www.sede2.es', 'En el laboratorio «Internet: dos sedes y DNS públicos», ¿quién responde de verdad cuando PC1 pregunta por www.sede2.es? Busca las piezas en la nube ISP-Sur y en SRV-SEDE2.', 'En ISP-Sur → ISP, sede2.es está registrado como NS con 81.33.3.2; en la línea DSL0, la redirección lleva TCP 80, TCP 22 y UDP 53 a 192.168.1.10. SRV-SEDE2 tiene la zona sede2.es (www CNAME srv, srv A 81.33.3.2). Así `host www.sede2.es` en PC1 devuelve el alias de la zona de SRV-SEDE2, y la web la sirve también SRV-SEDE2.'),
      ],
    },
    {
      id: 'red-broadcast',
      title: 'Broadcast: a todos los equipos de la red',
      summary: 'Broadcast de enlace e IP (255.255.255.255 y dirigido), quién responde a un ping a broadcast y quién lo reenvía.',
      blocks: [
        p('Un broadcast llega a todos los equipos del segmento: el switch lo inunda por todos los puertos de su VLAN y ningún router lo pasa a otra red. Lo usan ARP y DHCP (MAC ff:ff:ff:ff:ff:ff) y se puede probar a nivel IP con ping.'),
        table(['Destino', 'Qué es', 'Llega a'], [
          ['255.255.255.255', 'Broadcast limitado', 'La red local del emisor; ningún router lo reenvía.'],
          ['192.168.1.255 (en una /24)', 'Broadcast dirigido de la subred', 'Esa subred. Desde otra red, el router responde él mismo y solo lo reenvía si se activa (abajo).'],
        ]),
        table(['Equipo', '¿Responde a un ping a broadcast?', 'Cómo cambiarlo'], [
          ['Router y switch Cisco', 'Sí, con su propia dirección', '—'],
          ['GNU/Linux (Server, router Linux, PC en modo Linux)', 'No (Ubuntu: net.ipv4.icmp_echo_ignore_broadcasts = 1)', 'sudo sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0'],
          ['Windows (PC por defecto)', 'No', '—'],
        ]),
        code('$ ping 192.168.1.255\nping: Do you want to ping broadcast? Then -b. If not, check your local firewall rules\n$ ping -b -c 2 192.168.1.255\nWARNING: pinging broadcast address\nPING 192.168.1.255 (192.168.1.255) 56(84) bytes of data.\n64 bytes from 192.168.1.1: icmp_seq=1 ttl=255 time=0.400 ms\n64 bytes from 192.168.1.20: icmp_seq=1 ttl=64 time=0.400 ms (DUP!)\n…\n2 packets transmitted, 2 received, +2 duplicates, 0% packet loss\n\nRouter# ping 192.168.1.255\nReply to request 0 from 192.168.1.20, 1 ms'),
        h('Reenvío de broadcast dirigido'),
        p('Desactivado por defecto, porque permite ataques de amplificación (smurf). En un router Cisco se activa en la interfaz de salida con ip directed-broadcast (no ip directed-broadcast es lo normal desde IOS 12.0); en el router Linux, con sudo sysctl -w net.ipv4.conf.all.bc_forwarding=1 y el reenvío activado.'),
        p('Como en Linux, quien hace el ping también recibe su propia copia del broadcast: si tiene icmp_echo_ignore_broadcasts=0, se responde a sí mismo (su dirección aparece en la lista).'),
        note('En modo simulación se ve una sola trama con destino ff:ff:ff:ff:ff:ff que el switch copia a cada puerto, y después una respuesta por cada equipo que contesta.'),
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
