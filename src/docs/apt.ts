/** Documentación: instalar servicios con apt y los huevos de Pascua de Netfix, en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, h, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

const COW = '                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...';

export const APT_DOCS: readonly DocPage[] = [
  {
    id: 'linux-apt',
    title: 'Instalar paquetes con apt',
    summary: 'apt de Ubuntu 26.04 con alcance limitado: fuentes reales, red real y un catálogo ficticio que activa los servicios del servidor, nmcli, mDNS y Samba.',
    markdownBase: MD,
    blocks: [
      p('Un **Server** o un **router GNU/Linux** colocado desde la paleta no trae ningún servicio: solo su configuración IP, los ficheros de configuración, los registros, los parámetros del kernel y su terminal. Cada servicio (SSH, DHCP, DNS, HTTP, correo, cortafuegos, VPN y también **Samba**, que además tienen los PCs con GNU/Linux) se añade con su casilla de la pestaña **Configuración** o, como en un Ubuntu real, instalando su paquete con `apt`. Los dos caminos siempre coinciden: `apt install` marca la casilla, añade su panel a **Servicios** y activa su página en la **gestión web**; `apt remove` la desmarca, quita el panel y desactiva la página (en gris, u oculta con la opción del laboratorio), y marcar o desmarcar la casilla equivale a instalar o quitar el paquete.'),
      p('apt lee las fuentes de Ubuntu 26.04 («resolute») de **/etc/apt/sources.list.d/ubuntu.sources** (formato deb822) y se conecta de verdad a archive.ubuntu.com y security.ubuntu.com por la red simulada. Solo funciona si el equipo tiene salida a la Internet emulada (una **Nube ISP** en el laboratorio) y un servidor DNS que resuelva esos nombres (8.8.8.8, o el tuyo reenviando a él).'),
      h('Qué hace cada orden'),
      table(['Orden', 'Qué hace en Netfix'], [
        ['sudo apt update', 'Comprueba cada fuente («Hit:») y no cambia nada: el catálogo siempre está al día. Sin conexión: «Ign:», «Err:» y los avisos reales.'],
        ['sudo apt upgrade · full-upgrade', 'Todo está en la última versión: «Upgrading: 0».'],
        ['sudo apt autoremove', 'Quita las dependencias que apt instaló solas y ya ningún paquete necesita (`apt list --installed` las marca «automatic»): tras `apt remove samba`, por ejemplo, samba-common-bin y con él `nmblookup`. Si no queda ninguna: «Removing: 0».'],
        ['sudo apt install PAQUETE', 'Descarga (pasa tiempo de simulación), instala, activa la casilla del servicio y lo arranca. Pregunta «Continue? [Y/n]» salvo con -y.'],
        ['sudo apt remove · purge PAQUETE', 'Para el servicio y quita su casilla y su panel. Funciona sin conexión. Sus dependencias se quedan («no longer required») hasta `apt autoremove`.'],
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
        ['samba', 'Samba (servidores, routers GNU/Linux y PCs). Configuración → Laboratorio actual puede quitárselo a cada tipo de equipo: entonces apt da «Unable to locate package samba».'],
      ]),
      h('Paquetes para cualquier equipo GNU/Linux'),
      p('Estos se instalan en cualquier terminal GNU/Linux, también en un PC, y quedan guardados con el equipo:'),
      table(['Paquete', 'Qué añade'], [
        ['network-manager', '`nmcli`: estado de las interfaces, direcciones IP, rutas, DNS y conectividad (`nmcli`, `nmcli device show`, `nmcli connection show`, `nmcli general`). Antes de instalarlo, bash propone «sudo apt install network-manager».'],
        ['avahi-daemon', 'mDNS: el equipo responde a su nombre seguido de **.local** y puede preguntar por los demás (`ping pc1.local`, `ssh admin@srv.local`) sin servidor DNS. Trae libnss-mdns.'],
        ['libnss-mdns', 'Solo pregunta por los nombres .local; no responde por el suyo.'],
        ['libnss-resolve', 'La fuente NSS `resolve`: ping, ssh y `getent` preguntan a systemd-resolved y ven lo mismo que `resolvectl query`, LLMNR y mDNS incluidos. Su instalación pone `resolve [!UNAVAIL=return]` delante de dns en /etc/nsswitch.conf.'],
        ['nftables', 'El cortafuegos (`nft`, /etc/nftables.conf). En un PC añade a Servicios los paneles Firewall, Configuración y Registros.'],
        ['smbclient', '`smbclient`: lista y abre carpetas compartidas de otro equipo (Windows o samba) desde la terminal.'],
      ]),
      p('mDNS va por multicast (224.0.0.251, puerto UDP 5353) a los equipos del mismo enlace: lo propagan los switches pero no los routers, así que solo funciona dentro de la misma red, y el otro equipo también debe tener avahi-daemon. En modo Simulación verás los paquetes MDNS; un cortafuegos que bloquee el puerto 5353 lo impide.'),
      p('Los equipos **Windows** (PC o Windows Server) traen mDNS de serie, como Windows 10 y 11: sin instalar nada responden a su nombre .local y preguntan por los demás (`ping pc1.local` en la Terminal Windows). Windows pregunta desde el puerto 5353 y la respuesta llega por multicast; nss-mdns, desde un puerto propio y con respuesta directa.'),
      h('Sin terminal: la casilla de cada paquete'),
      p('La pestaña **Configuración** de cada equipo con GNU/Linux tiene dos apartados de casillas, una por paquete del catálogo. **Paquetes de servicios**: los de los servicios que hacen algo en ese equipo (en un Server, openssh-server, kea-dhcp4-server, bind9, apache2, postfix, dovecot-imapd, dovecot-pop3d, nftables, rsyslog y samba; un router GNU/Linux añade wireguard-tools; un PC, nftables y samba). La casilla de un paquete de servicio y la de su servicio en el apartado Servicios son la misma: marcar bind9 marca DNS y hace aparecer su panel en Servicios y su página en la gestión web, y desmarcar la casilla DNS es `apt remove bind9`; la casilla Correo instala o quita a la vez postfix, dovecot-imapd y dovecot-pop3d. **Paquetes**: las herramientas (network-manager, avahi-daemon, libnss-mdns, libnss-resolve, smbclient, samba-common-bin, winbind, libnss-winbind y bind9-utils). Marcar cualquiera hace lo mismo que `sudo apt install` (dependencias, scripts de instalación, servicios y /var/log/dpkg.log) sin necesitar red, como la casilla de Samba; desmarcarla, lo mismo que `sudo apt remove`. La terminal y la casilla se siguen: lo que instala una aparece marcado en la otra.'),
      p('En **Configuración → Laboratorio actual**, **Paquetes del repositorio apt** decide qué paquetes existen en esta red. Están los paquetes de servicios y las herramientas. Uno desmarcado desaparece de la pestaña de los equipos y `apt install` responde «Unable to locate package», como si se hubiera quitado del repositorio, también por su nombre corto (ssh, kea, wireguard); en un equipo que no tiene ese servicio desaparece además su casilla de servicio. Quien ya lo tiene lo conserva y puede quitarlo con `apt remove` o con su casilla. La lista solo limita lo que se instala por su nombre: un paquete quitado que es dependencia de otro (bind9-utils de bind9, samba-common-bin de samba) llega igualmente con él. Un Windows sin terminal GNU/Linux no tiene apt y conserva siempre sus casillas de servicio.'),
      h('NetBIOS y carpetas compartidas: samba'),
      p('Windows trae de serie NetBIOS sobre TCP/IP: responde a su nombre (NOMBRE<00> y WORKGROUP, y NOMBRE<20> si comparte archivos) y resuelve un nombre sin punto por broadcast a su red (UDP 137) si el DNS no lo conoce; con **Compartir archivos e impresoras para redes Microsoft** marcada en su pestaña **Configuración**, escucha además SMB en TCP 139 y 445. Un equipo GNU/Linux hace lo mismo con el servicio **Samba** (paquete samba: smbd y nmbd); `nmblookup NOMBRE` (y `nmblookup -A IP`) consulta NetBIOS desde la terminal, y el nombre propio responde mientras nmbd está en marcha (`localhost` no es un nombre NetBIOS, tampoco en Windows).'),
      p('Samba es un servicio más, como DNS o DHCP, en servidores, routers GNU/Linux y también PCs: smb.conf, las cuentas (`smbpasswd`), los permisos, `net use` desde Windows y `smbclient` desde GNU/Linux se explican en **Servidor → Samba** (páginas «Samba: compartir carpetas» y «Samba: acceder desde Windows y GNU/Linux»), y se practican en el laboratorio «Compartir carpetas con Samba en un servidor GNU/Linux».'),
      p('Para que los programas de GNU/Linux (ping, ssh…) resuelvan nombres NetBIOS, como en un Ubuntu real: `sudo apt install winbind libnss-winbind` y añadir **wins** a la línea `hosts:` de **/etc/nsswitch.conf** (por ejemplo `hosts: files dns wins`). Igual que mDNS, el broadcast NetBIOS no cruza routers; un servidor WINS sí (`wins support = yes` en el servidor y `wins server = IP` en los clientes; consulta «Resolución de nombres»).'),
      p('Por la misma razón, desde GNU/Linux mDNS necesita siempre avahi-daemon o libnss-mdns: al instalarlos, su script añade `mdns4_minimal [NOTFOUND=return]` a `hosts:` en /etc/nsswitch.conf, y al quitarlos lo borra.'),
      h('La pestaña Servicios de un PC GNU/Linux'),
      p('Un PC no tiene gestión web (no tiene servidor HTTP): lo que configura un servidor desde el navegador, en un PC se hace en su terminal o en su pestaña **Servicios**. Un PC con GNU/Linux muestra siempre los **Parámetros** del kernel (sysctl). `sudo apt install nftables` añade **Firewall**; `sudo apt install samba`, **Samba**; y cualquiera de los dos, **Configuración** (sus ficheros) y **Registros** (journalctl de nftables, smbd y nmbd). `sudo apt remove` los quita al momento. Un PC con Windows no tiene esta pestaña.'),
      p('En un **Server** o un router GNU/Linux, instalar samba añade el panel **Samba** a Servicios y la página Samba a la gestión web, y smbd y nmbd aparecen en Registros; quitarlo los hace desaparecer.'),
      term('shell', 'alumno@pc1:~$ ping -c 1 pc0.local\nPING pc0.local (192.168.10.10) 56(84) bytes of data.\n64 bytes from pc0.local (192.168.10.10): icmp_seq=1 ttl=64 time=0.400 ms'),
      term('shell', 'root@srv:~# apt install -y apache2\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nInstalling:\n  apache2\n\nInstalling dependencies:\n  apache2-bin  apache2-data  apache2-utils  libapr1t64  libaprutil1t64  ssl-cert\n…\nSetting up apache2 (2.4.62-1ubuntu1) ...\nCreated symlink \'/etc/systemd/system/multi-user.target.wants/apache2.service\' → \'/usr/lib/systemd/system/apache2.service\'.'),
      steps(
        ['Coloca un servidor', 'Desde la paleta, con una salida a Internet (una Nube ISP o un router que llegue a ella) y como DNS 8.8.8.8.'],
        ['Abre su terminal GNU/Linux', '`sudo apt update` debe dar cuatro «Hit:».'],
        ['Instala el servicio', '`sudo apt install apache2`: la pestaña Servicios aparece al momento con HTTP, y la casilla HTTP de Configuración queda marcada.'],
      ),
      check('Compruébalo', 'Desde un PC, el navegador abre la web del servidor. `sudo apt remove apache2` para Apache y quita el panel; la casilla también se desmarca.'),
      warn('Sin conexión', 'Si el DNS no responde verás «Temporary failure resolving \'archive.ubuntu.com\'»; si el nombre no existe, «Could not resolve»; si no hay ruta, «Could not connect … connection timed out». Revisa la puerta de enlace y el DNS, como en un servidor real.'),
      tip('Alcance limitado', 'Solo están los paquetes de los servicios de Netfix, network-manager, avahi-daemon, libnss-mdns, libnss-resolve, samba, smbclient, winbind, libnss-winbind y los del sistema base (que no se pueden quitar). Un nombre que no está en el catálogo da «Unable to locate package». Sin sudo, apt da el error real del bloqueo de dpkg.'),
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
