/** Documentación: uso de Netfix (interfaz, usuarios, guardar, simulación). */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const NETFIX_DOCS: DocGroup = {
  id: 'netfix',
  title: 'Netfix',
  pages: [
    {
      id: 'inicio',
      title: 'Primeros pasos',
      summary: 'La interfaz: barra superior, área de trabajo, paleta de dispositivos y ventanas.',
      blocks: [
        p('Netfix es un simulador de redes en el navegador con el aspecto y el comportamiento de Cisco Packet Tracer. Todo se ejecuta en tu equipo: no hay servidor ni se envía nada a Internet (la «Internet» de las nubes ISP también es simulada).'),
        h('Barra superior'),
        table(['Control', 'Qué hace'], [
          ['Red / Documentación / Donaciones / Acerca de', 'Cambia entre el área de trabajo, esta documentación, la página para apoyar el proyecto (PayPal.Me) y la información de versión, autoría, licencias y atribuciones (tomada de package.json y LICENSE.md).'],
          ['Nuevo · Abrir… · Guardar', 'Área vacía, abrir un .json o guardar la topología (Ctrl+S).'],
          ['Laboratorios…', 'Carga una práctica preparada: DHCP (básico, reservas, relay, VLAN, snooping, router cliente), Server, Internet con dos sedes, VPN IPsec y WireGuard, router Linux con DMZ, DNS que reenvía, SSH/SFTP y bastionado.'],
          ['Reloj y «Avanzar reloj…»', 'Hora simulada. Adelantarla 1 minuto, 1 hora o 1 día hace caducar o renovar concesiones DHCP.'],
          ['Tiempo real / Simulación', 'Modo de ejecución (ver «Tiempo real y simulación»).'],
          ['Idioma', 'Español (España) o English (UK): cambia toda la interfaz, la documentación y las páginas web simuladas sin recargar.'],
        ]),
        h('Paleta y herramientas'),
        list(
          'Por orden: PC, Servidor (Server), Switch IOS (2960-24TT), Router IOS (2911), Router Linux (Ubuntu, en hardware 2911) y Nube (ISP → Internet). Los dos routers van juntos y comparten el símbolo de router. Elige uno y haz clic (o toca) en el área de trabajo.',
          'Cable: haz clic en un equipo, elige el puerto, y repite en el otro extremo. El tipo de cable se elige solo.',
          'Seleccionar: arrastra equipos; doble clic abre su ventana. Con un equipo o un cable seleccionado, Supr o Retroceso lo borra (un equipo se lleva sus cables).',
          'Eliminar: borra equipos o cables.',
          'Deshacer (Ctrl+Z, ↶) y Rehacer (Ctrl+Y o Ctrl+Mayús+Z, ↷): añadir, borrar o mover equipos, cables y dibujos (hasta 100 pasos). Un equipo borrado vuelve con sus cables y su configuración; lo escrito dentro de un equipo (CLI, paneles) no se deshace desde aquí.',
          'Dibujo: abre la barra para delimitar áreas, trazar líneas y escribir etiquetas (ver «Dibujo»).',
        ),
        h('Ventanas de los equipos'),
        table(['Equipo', 'Pestañas'], [
          ['Router IOS / Switch IOS', 'Equipo (nombre visible y hostname), Interfaces (estado, MAC, extremo del cable, descripción, dirección o VLAN y shutdown, aplicados como órdenes de la CLI), CLI (Cisco IOS 15) y Gestión web (ip http server).'],
          ['Nube ISP', 'ISP (proveedor, bloque público, dominios), Interfaces (resumen de las seis líneas) y Líneas (modo, LAN, NAT, redirección de puertos).'],
          ['PC', 'Equipo, Interfaces (MAC, enlace, velocidad, extremo del cable y estado del puerto), Configuración IP, Navegador, Correo, Cliente SSH, Archivos (SFTP), Terminal Windows y Terminal Linux.'],
          ['Router Linux', 'Equipo, Interfaces (dirección de eth0-eth2, MAC, extremo del cable, reenvío y rutas), Servicios (Parámetros, Firewall, VPN, y los servicios de Server empezando por SSH) y Terminal Linux.'],
          ['Server', 'Equipo, Interfaces, Servicios (SSH, DHCP, DNS, HTTP, correo, Registros y Ficheros), Configuración IP, Terminal Linux y Terminal Windows. Sin paneles de núcleo ni cortafuegos: son del Router Linux (en su terminal siguen sysctl y nft).'],
        ]),
        note('Los campos de los equipos se aplican al cambiarlos (Intro o al salir del campo): nombre, direcciones, nube e ISP. Llevan botón los servicios («Aplicar» equivale a reiniciarlos con systemctl), los formularios que se traducen a órdenes de IOS y las listas (añadir un pool, una zona, una ruta…).'),
        note('Las ventanas se mueven por la cabecera y cambian de tamaño desde la esquina. Escape cierra la ventana activa (salvo dentro de nano o vim). En móvil y tableta las ventanas ocupan la pantalla, el lienzo se mueve con un dedo y se amplía pellizcando, una pulsación larga abre un equipo y la terminal tiene una barra de teclas: Esc, Tab, Ctrl (se queda pulsada para la tecla siguiente), flechas, Inicio, Fin, RePág, AvPág, ^C y ^D, y con un editor abierto F1-F10. Fuera de los editores, Inicio y Fin van al principio o al final de la línea, y RePág y AvPág desplazan la salida.'),
      ],
    },
    {
      id: 'usuarios',
      title: 'Usuarios y contraseñas',
      summary: 'Cuentas de las terminales, de SSH y del correo en los laboratorios.',
      blocks: [
        p('Todas son credenciales de laboratorio, ficticias. Las cuentas SSH y de correo se cambian en la pestaña Servicios del servidor.'),
        h('Laboratorio «Server: DHCP, DNS, web, correo y SSH»'),
        table(['Uso', 'Usuario', 'Contraseña', 'Dónde'], [
          ['Correo (IMAP)', 'ana → ana@aula.lab', 'ana1', 'Buzón en srv; cuenta configurada en el Correo de PC0'],
          ['Correo (POP3)', 'luis → luis@aula.lab', 'luis1', 'Buzón en srv; cuenta configurada en el Correo de PC1'],
          ['SSH', 'admin', 'netfix', 'ssh admin@srv.aula.lab o ssh admin@192.168.10.2'],
          ['Gestión web', 'admin', 'netfix', 'http://srv.aula.lab:10000 (por defecto en todo Server o Router Linux al activarla)'],
        ]),
        h('Cuentas de las terminales'),
        table(['Equipo', 'GNU/Linux', 'Windows'], [['PC', 'alumno', 'user'], ['Server', 'admin', 'Administrator']]),
        h('Cuentas del sistema Linux de cada equipo'),
        table(['Cuenta', 'UID', 'Grupos', 'Notas'], [
          ['root', '0', 'root', 'Sin contraseña: su no permite entrar; usa sudo -i.'],
          ['alumno (PC) / admin (servidor)', '1000', 'alumno|admin, adm, sudo, users', 'Usuario de la terminal local. Puede usar sudo.'],
          ['Cuentas SSH del servidor', '1001–9999 (fijo por nombre)', 'propio, users', 'Una por cada usuario SSH; no están en el grupo sudo.'],
        ]),
        p('sudo pide la contraseña de la cuenta cuando existe una cuenta SSH con ese nombre (admin/netfix en el laboratorio) y la recuerda 15 minutos, como Ubuntu. En los PC no hay cuentas SSH, así que sudo no pide contraseña.'),
        code('admin@srv:~$ sudo systemctl restart apache2\n[sudo] password for admin:\nadmin@srv:~$ sudo -i\nroot@srv:~#'),
      ],
    },
    {
      id: 'dibujo',
      title: 'Dibujo: áreas, líneas y etiquetas',
      summary: 'Delimitar redes con áreas de color, trazar líneas o a mano alzada y escribir etiquetas sobre el área de trabajo.',
      blocks: [
        p('El botón Dibujo de la paleta abre una barra flotante para anotar el diagrama: marcar la red privada, la DMZ o Internet, escribir la dirección de red o señalar un túnel. Los dibujos no cambian la red simulada y se guardan con la topología.'),
        table(['Herramienta', 'Uso'], [
          ['▭ Rectángulo · ◯ Elipse', 'Arrastra para delimitar un área. Al soltar pide su nombre (por ejemplo «LAN · 192.168.1.0/24»); Escape lo deja sin nombre.'],
          ['╱ Línea · ✎ Mano alzada', 'Arrastra para trazar una línea recta o libre (un túnel, un flujo de tráfico, un subrayado).'],
          ['T Etiqueta de texto', 'Haz clic donde va el texto y escríbelo; Intro acepta.'],
          ['Colores', 'Nueve colores básicos y un selector RGB para cualquier otro; el actual se ve a la izquierda.'],
          ['Relleno · grosor', 'Las áreas pueden llevar un relleno suave de su color; el grosor del trazo va de 1 a 6 px.'],
        ]),
        list(
          'Con Seleccionar, arrastra un dibujo por su borde o su texto para moverlo; el interior de un área deja pasar los clics al fondo y a los equipos.',
          'Doble clic en un área o etiqueta: cambiar su texto. Con un dibujo seleccionado, elegir otro color, relleno o grosor lo cambia.',
          'Para borrar un dibujo: selecciónalo y pulsa Borrar dibujo en la barra (o Supr), o elige la herramienta Eliminar y toca el dibujo; con ella basta tocar el interior de un área.',
          'Borrar todos (en la barra, tras confirmar) quita todos los dibujos, también las áreas que trae un laboratorio; los equipos y los cables no cambian.',
          'Los laboratorios ya traen áreas para las redes privadas, Internet, la DMZ, los invitados, los servidores, las VLAN y los túneles VPN.',
        ),
        note('Los dibujos van debajo de los cables y de los equipos, y «Ajustar a la red» también los tiene en cuenta.'),
      ],
    },
    {
      id: 'guardar',
      title: 'Guardar y abrir',
      summary: 'Qué guarda el archivo .json y cómo se recupera.',
      blocks: [
        p('Guardar (o Ctrl+S) crea un archivo .json con toda la arquitectura. En Chrome y Edge aparece el diálogo para elegir nombre y carpeta; en otros navegadores se descarga. Además, el área de trabajo se guarda sola en el navegador.'),
        list(
          'Posiciones de los equipos y cables.',
          'Configuración IOS (running-config y startup-config).',
          'IP, Client-ID y sistema operativo de PCs y servidores.',
          'Servicios, registros DNS, pools y reservas DHCP, páginas web, buzones y cuentas de correo.',
          'Ficheros creados o modificados desde la Terminal Linux (home, scripts, cambios en /etc, historial de bash).',
        ),
        note('Límites de los ficheros de la terminal: 256 KiB por fichero y 4 MiB por equipo. Los ficheros generados (configuración de servicios) no se guardan: se recalculan.'),
        p('Abrir… valida el archivo antes de usarlo y sigue aceptando el formato anterior (v1).'),
      ],
    },
    {
      id: 'simulacion',
      title: 'Tiempo real y simulación',
      summary: 'Ver los paquetes paso a paso: lista de eventos, PDU y filtros por protocolo.',
      blocks: [
        p('En Tiempo real la red funciona sola. En Simulación, cada paquete queda en la lista de eventos y se puede reproducir paso a paso, como en Packet Tracer.'),
        list(
          'Reproducir / Pausa / Paso: avanzan la simulación.',
          'Filtros: DHCP, DNS, ARP, ICMP, TCP, HTTP, SMTP, POP3, IMAP y SSH.',
          'Al elegir un evento se ve la PDU por capas (Ethernet II, IPv4, UDP/TCP y el mensaje de aplicación).',
          'SSH aparece como «datos cifrados»: su contenido no se puede leer en tránsito.',
        ),
        h('Ejemplo: ver el DORA de DHCP'),
        code('1. Pulsa «Simulación».\n2. En un PC: Terminal Windows → ipconfig /release y ipconfig /renew\n   (o Terminal Linux → sudo dhclient -r eth0 && sudo dhclient eth0).\n3. Pulsa «Paso» y observa DISCOVER, OFFER, REQUEST y ACK.'),
      ],
    },
  ],
};
