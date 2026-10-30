/** Documentation: name resolution (hosts, DNS, mDNS, LLMNR and NetBIOS), how each system chooses and its labs. */
import type { DocPage } from './types.ts';
import { check, code, exercise, figure, h, list, p, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const NAMES_DOCS: readonly DocPage[] = [
  {
    id: 'red-nombres',
    title: 'Resolución de nombres: hosts, DNS, mDNS, LLMNR y NetBIOS',
    summary: 'Cinco maneras de pasar de un nombre a una dirección IP, cuál usa cada sistema y en qué orden, qué cruza un router y cómo verlo en Simulación.',
    markdownBase: MD,
    blocks: [
      p('Antes de enviar un `ping pc2`, el equipo necesita la **dirección IP** de pc2. Hay varias maneras de averiguarla: un fichero local, un servidor DNS o preguntar a toda la red local. Windows y GNU/Linux las prueban en un orden distinto, y solo una de ellas cruza routers.'),
      h('Los protocolos'),
      table(['Protocolo', 'Nombres', 'Cómo pregunta', 'Alcance', 'Quién responde en Netfix'], [
        ['hosts', 'Cualquiera', 'Lee el fichero /etc/hosts del equipo', 'El propio equipo', 'Nadie: es local'],
        ['DNS', 'Con dominio (y sin punto, con el sufijo de búsqueda)', 'Unicast, UDP 53, al servidor DNS configurado', 'Cruza routers', 'Un servidor DNS (bind9, 8.8.8.8…)'],
        ['mDNS', 'Acabados en .local', 'Multicast 224.0.0.251, UDP 5353', 'El enlace: no cruza routers', 'Windows de serie; GNU/Linux con avahi-daemon'],
        ['LLMNR', 'De una sola etiqueta (pc2)', 'Multicast 224.0.0.252, UDP 5355, TTL 1', 'El enlace: no cruza routers', 'Windows de serie'],
        ['NetBIOS (NBNS)', 'De una sola etiqueta, hasta 15 caracteres', 'Broadcast de la subred, UDP 137', 'La subred: no cruza routers', 'Windows de serie; GNU/Linux con samba'],
      ]),
      p('mDNS, LLMNR y NetBIOS no necesitan servidor: preguntan a todos los equipos del enlace y responde el que tiene ese nombre. Por eso sirven en una red de casa o un aula sin DNS propio, pero no para llegar a otra red.'),
      h('Orden en Windows'),
      list(
        'El fichero hosts (en Netfix, el /etc/hosts del equipo, el mismo de su terminal GNU/Linux).',
        'Si el nombre acaba en **.local**: mDNS (y, si nadie responde, el DNS).',
        'El **DNS**, con el sufijo de búsqueda: `ping srv` pregunta srv.aula.lab si el DHCP dio el dominio aula.lab.',
        'Si el DNS no lo conoce y el nombre es de **una etiqueta**: **LLMNR y NetBIOS a la vez**. Gana la respuesta LLMNR; la de NetBIOS solo cuenta si LLMNR no encuentra nada.',
      ),
      figure({
        type: 'sequence',
        actors: ['WIN1', '8.8.8.8 (DNS)', 'Toda la LAN', 'WIN2'],
        messages: [
          { from: 0, to: 1, text: 'DNS A? win2', note: 'UDP 53 (con el sufijo, si lo hay)' },
          { from: 1, to: 0, text: 'NXDOMAIN', note: 'el DNS público no conoce win2' },
          { from: 0, to: 2, text: 'LLMNR A? win2', note: 'multicast 224.0.0.252:5355' },
          { from: 0, to: 2, text: 'NBNS Query WIN2<00>', note: 'broadcast 192.168.1.255:137' },
          { from: 3, to: 0, text: 'LLMNR: 192.168.1.12', note: 'unicast desde el 5355' },
          { from: 3, to: 0, text: 'NBNS Response', note: 'unicast; queda en la caché (nbtstat -c)' },
        ],
      }, '`ping win2` desde WIN1 en el laboratorio «Nombres en una LAN sin DNS propio». En Simulación, con los filtros DNS, LLMNR y NBNS.'),
      h('Orden en GNU/Linux'),
      p('glibc sigue la línea `hosts:` de **/etc/nsswitch.conf**, de izquierda a derecha. Ubuntu Server trae `files dns`: el fichero /etc/hosts y después el DNS. Cada paquete añade su fuente:'),
      table(['Fuente', 'Paquete', 'Cómo se añade'], [
        ['files', '(base)', 'Viene de serie: /etc/hosts.'],
        ['dns', '(base)', 'Viene de serie: los servidores de /etc/resolv.conf.'],
        ['mdns4_minimal [NOTFOUND=return]', 'libnss-mdns (lo trae avahi-daemon)', 'Lo pone su instalación y lo quita su desinstalación. Solo pregunta los .local; si nadie responde, no sigue al DNS.'],
        ['wins', 'winbind y libnss-winbind', 'A mano, como en un Ubuntu real.'],
      ]),
      code('hosts:          files mdns4_minimal [NOTFOUND=return] dns wins'),
      p('Los equipos GNU/Linux de Netfix no hablan LLMNR: ni preguntan ni responden. Para que Windows encuentre a un GNU/Linux por su nombre, instálale **avahi-daemon** (pc.local) o **samba** (nombre sin punto, por NetBIOS).'),
      warn('Un PC con las dos terminales', 'La terminal Windows de un PC resuelve a la manera de Windows (mDNS, LLMNR y NetBIOS de serie) y su terminal GNU/Linux a la manera de GNU/Linux: sin avahi, `ping pc2.local` falla allí aunque en la terminal Windows funcione.'),
      h('Herramientas'),
      table(['Orden', 'Sistema', 'Qué hace'], [
        ['ping NOMBRE', 'Los dos', 'Resuelve como el sistema y muestra la dirección IP que obtuvo.'],
        ['nslookup · dig · host', 'Los dos / GNU/Linux', 'Preguntan **solo al DNS**: no usan hosts, mDNS, LLMNR ni NetBIOS.'],
        ['nbtstat -n · -a · -A · -c · -R', 'Windows', 'Tabla NetBIOS propia o remota, caché y purga.'],
        ['nmblookup NOMBRE · -A IP', 'GNU/Linux con samba', 'Consulta NetBIOS por broadcast o tabla de un equipo.'],
      ]),
      term('cmd', 'C:\\>ping -n 1 win2\n\nPinging win2 [192.168.1.12] with 32 bytes of data:\n\nReply from 192.168.1.12: bytes=32 time<1ms TTL=128'),
      tip('Verlo en Simulación', 'Pasa a **Simulación**, deja marcados DNS, MDNS, LLMNR y NBNS y lanza el ping: verás la pregunta DNS, la multicast LLMNR (MAC 01:00:5e:00:00:fc, TTL 1), el broadcast NBNS y las respuestas unicast. Pulsa cada evento para ver su PDU.'),
      h('Laboratorios'),
      p('En **Laboratorios… → Resolución de nombres** hay tres prácticas: «Nombres en una LAN sin DNS propio», «Nombres entre redes» y «DNS de empresa que reenvía a Internet».'),
      exercise('Cuatro equipos, cuatro maneras', 'En «Nombres en una LAN sin DNS propio», consigue que cada equipo haga ping a los otros tres por su nombre y anota qué protocolo lo resuelve en cada caso.', 'WIN1 ↔ WIN2: LLMNR (`ping win2`) o mDNS (`ping win2.local`). WIN → LNX1: `ping lnx1.local` (avahi responde). LNX1 → WIN: `ping win1.local` (avahi pregunta). LNX2 no pregunta ni responde: `echo "192.168.1.11 win1" | sudo tee -a /etc/hosts` (hosts), o `sudo apt install samba` para que Windows lo encuentre por NetBIOS (`ping lnx2`) y `sudo apt install avahi-daemon` para que pregunte .local.'),
      exercise('Lo que no cruza el router', 'En «Nombres entre redes», desde WIN-A, `ping win-b` funciona y `ping win-b2` no. Desde WIN-B, `ping win-b2` sí. Explica por qué y arréglalo sin tocar WIN-A.', 'win-b está en la zona aula.lab de SRV y el DNS cruza el router; win-b2 no está, y LLMNR y NetBIOS se quedan en la LAN B (multicast con TTL 1 y broadcast de subred). Desde WIN-B responde WIN-B2 por LLMNR. Añade en SRV (Servicios → DNS → aula.lab) el registro `win-b2` A 192.168.20.12: `ping win-b2` desde WIN-A resuelve win-b2.aula.lab.'),
      check('Comprueba', '`nslookup win-b2` desde WIN-A responde con 192.168.20.12 y en Simulación ya no aparecen paquetes LLMNR ni NBNS: el DNS lo resolvió antes.'),
    ],
  },
];
