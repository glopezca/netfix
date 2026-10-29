/** Documentación: instalar servicios con apt y los huevos de Pascua de Netfix, en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, h, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

const COW = '                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...';

export const APT_DOCS: readonly DocPage[] = [
  {
    id: 'linux-apt',
    title: 'Instalar paquetes con apt',
    summary: 'apt de Ubuntu 26.04 con alcance limitado: fuentes reales, red real y un catálogo ficticio que activa los servicios del servidor, nmcli y mDNS.',
    markdownBase: MD,
    blocks: [
      p('Un **Server** o un **router GNU/Linux** colocado desde la paleta no trae ningún servicio: solo su configuración IP, los ficheros de configuración, los registros, los parámetros del kernel y su terminal. Cada servicio se añade con una casilla de su pestaña **Configuración** o, como en un Ubuntu real, instalando su paquete con `apt`.'),
      p('apt lee las fuentes de Ubuntu 26.04 («resolute») de **/etc/apt/sources.list.d/ubuntu.sources** (formato deb822) y se conecta de verdad a archive.ubuntu.com y security.ubuntu.com por la red simulada. Solo funciona si el equipo tiene salida a la Internet emulada (una **Nube ISP** en el laboratorio) y un servidor DNS que resuelva esos nombres (8.8.8.8, o el tuyo reenviando a él).'),
      h('Qué hace cada orden'),
      table(['Orden', 'Qué hace en Netfix'], [
        ['sudo apt update', 'Comprueba cada fuente («Hit:») y no cambia nada: el catálogo siempre está al día. Sin conexión: «Ign:», «Err:» y los avisos reales.'],
        ['sudo apt upgrade · full-upgrade', 'Todo está en la última versión: «Upgrading: 0».'],
        ['sudo apt autoremove', 'No hay nada que quitar.'],
        ['sudo apt install PAQUETE', 'Descarga (pasa tiempo de simulación), instala, activa la casilla del servicio y lo arranca. Pregunta «Continue? [Y/n]» salvo con -y.'],
        ['sudo apt remove · purge PAQUETE', 'Para el servicio y quita su casilla y su panel. Funciona sin conexión.'],
        ['apt list [--installed]', 'El catálogo, o solo lo instalado (base y servicios); admite un patrón como «dovecot*».'],
      ]),
      table(['Paquete', 'Servicio que activa'], [
        ['openssh-server (o ssh)', 'SSH'],
        ['kea-dhcp4-server (o kea)', 'DHCP'],
        ['bind9', 'DNS'],
        ['apache2', 'HTTP'],
        ['postfix · dovecot-imapd · dovecot-pop3d', 'Correo (SMTP, IMAP, POP3)'],
        ['nftables', 'Firewall (y, en la gestión web, Enrutamiento)'],
        ['wireguard (o wireguard-tools)', 'VPN (router GNU/Linux)'],
        ['rsyslog', 'Registros'],
      ]),
      h('Paquetes para cualquier equipo GNU/Linux'),
      p('Estos se instalan en cualquier terminal GNU/Linux, también en un PC, y quedan guardados con el equipo:'),
      table(['Paquete', 'Qué añade'], [
        ['network-manager', '`nmcli`: estado de las interfaces, direcciones IP, rutas, DNS y conectividad (`nmcli`, `nmcli device show`, `nmcli connection show`, `nmcli general`). Antes de instalarlo, bash propone «sudo apt install network-manager».'],
        ['avahi-daemon', 'mDNS: el equipo responde a su nombre seguido de **.local** y puede preguntar por los demás (`ping pc1.local`, `ssh admin@srv.local`) sin servidor DNS. Trae libnss-mdns.'],
        ['libnss-mdns', 'Solo pregunta por los nombres .local; no responde por el suyo.'],
      ]),
      p('mDNS va por multicast (224.0.0.251, puerto UDP 5353) a los equipos del mismo enlace: lo propagan los switches pero no los routers, así que solo funciona dentro de la misma red, y el otro equipo también debe tener avahi-daemon. En modo Simulación verás los paquetes MDNS; un cortafuegos que bloquee el puerto 5353 lo impide.'),
      p('Los equipos **Windows** (PC o Windows Server) traen mDNS de serie, como Windows 10 y 11: sin instalar nada responden a su nombre .local y preguntan por los demás (`ping pc1.local` en la Terminal Windows). Windows pregunta desde el puerto 5353 y la respuesta llega por multicast; nss-mdns, desde un puerto propio y con respuesta directa.'),
      term('shell', 'alumno@pc1:~$ ping -c 1 pc0.local\nPING pc0.local (192.168.10.10) 56(84) bytes of data.\n64 bytes from pc0.local (192.168.10.10): icmp_seq=1 ttl=64 time=0.400 ms'),
      term('shell', 'root@srv:~# apt install -y apache2\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nInstalling:\n  apache2\n\nInstalling dependencies:\n  apache2-bin  apache2-data  apache2-utils  libapr1t64  libaprutil1t64  ssl-cert\n…\nSetting up apache2 (2.4.62-1ubuntu1) ...\nCreated symlink \'/etc/systemd/system/multi-user.target.wants/apache2.service\' → \'/usr/lib/systemd/system/apache2.service\'.'),
      steps(
        ['Coloca un servidor', 'Desde la paleta, con una salida a Internet (una Nube ISP o un router que llegue a ella) y como DNS 8.8.8.8.'],
        ['Abre su terminal GNU/Linux', '`sudo apt update` debe dar cuatro «Hit:».'],
        ['Instala el servicio', '`sudo apt install apache2`: la pestaña Servicios aparece al momento con HTTP, y la casilla HTTP de Configuración queda marcada.'],
      ),
      check('Compruébalo', 'Desde un PC, el navegador abre la web del servidor. `sudo apt remove apache2` para Apache y quita el panel; la casilla también se desmarca.'),
      warn('Sin conexión', 'Si el DNS no responde verás «Temporary failure resolving \'archive.ubuntu.com\'»; si el nombre no existe, «Could not resolve»; si no hay ruta, «Could not connect … connection timed out». Revisa la puerta de enlace y el DNS, como en un servidor real.'),
      tip('Alcance limitado', 'Solo están los paquetes de los servicios de Netfix, network-manager, avahi-daemon, libnss-mdns y los del sistema base (que no se pueden quitar). Un nombre que no está en el catálogo da «Unable to locate package». Sin sudo, apt da el error real del bloqueo de dpkg.'),
      exercise('Un servidor DNS desde cero', 'Coloca un servidor en el laboratorio «Internet: dos sedes y DNS públicos», dale salida y conviértelo en servidor DNS solo con la terminal.', 'Configura la dirección IP, la puerta de enlace y el DNS 8.8.8.8; después `sudo apt update` y `sudo apt install -y bind9`. La pestaña Servicios muestra DNS y `systemctl status named` lo da activo.'),
    ],
  },
  {
    id: 'huevos',
    title: 'Huevos de Pascua',
    summary: 'Las sorpresas escondidas de Netfix, las mismas que en los programas reales.',
    markdownBase: MD,
    blocks: [
      p('Como los programas de verdad, Netfix esconde algunas sorpresas. Por ahora son dos.'),
      h('Los créditos de Midnight Commander'),
      p('En `mc`, **F2** o **F9** abren los créditos de Netfix y de GNU Midnight Commander.'),
      h('La supervaca de apt'),
      p('`apt moo` dibuja la vaca de apt, igual que en un Ubuntu real. Prueba también `apt moo moo` y `apt moo moo moo`. En algunas fechas la frase cambia, y el 1 de abril la vaca es otra (cuenta la fecha del reloj de la simulación).'),
      term('shell', `alumno@pc1:~$ apt moo\n${COW}`),
      tip('¿Hay más?', 'Puede que algún día aparezcan más. Si encuentras uno, ya sabes dónde mirar.'),
    ],
  },
];
