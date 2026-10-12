/** Documentación: uso de netsim (interfaz, usuarios, guardar, simulación). */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const NETSIM_DOCS: DocGroup = {
  id: 'netsim',
  title: 'netsim',
  pages: [
    {
      id: 'inicio',
      title: 'Primeros pasos',
      summary: 'La interfaz: barra superior, área de trabajo, paleta de dispositivos y ventanas.',
      blocks: [
        p('netsim es un simulador de redes en el navegador con el aspecto y el comportamiento de Cisco Packet Tracer. Todo se ejecuta en tu equipo: no hay servidor ni se envía nada a Internet.'),
        h('Barra superior'),
        table(['Control', 'Qué hace'], [
          ['Red / Documentación', 'Cambia entre el área de trabajo y esta documentación.'],
          ['Nuevo · Abrir… · Guardar', 'Área vacía, abrir un .json o guardar la topología (Ctrl+S).'],
          ['Laboratorios…', 'Carga una práctica preparada (DHCP básico, reservas, relay, VLAN, snooping, router cliente, Server-PT).'],
          ['Reloj y «Avanzar reloj…»', 'Hora simulada. Adelantarla 1 minuto, 1 hora o 1 día hace caducar o renovar concesiones DHCP.'],
          ['Tiempo real / Simulación', 'Modo de ejecución (ver «Tiempo real y simulación»).'],
        ]),
        h('Paleta y herramientas'),
        list(
          'Router 2911, Switch 2960-24TT, PC-PT y Server-PT: elige uno y haz clic en el área de trabajo.',
          'Cable: haz clic en un equipo, elige el puerto, y repite en el otro extremo. El tipo de cable se elige solo.',
          'Seleccionar: arrastra equipos; doble clic abre su ventana.',
          'Eliminar: borra equipos o cables.',
        ),
        h('Ventanas de los equipos'),
        table(['Equipo', 'Pestañas'], [
          ['Router / Switch', 'CLI (Cisco IOS 15).'],
          ['PC', 'Configuración IP, Navegador, Correo, Símbolo del sistema y Terminal Linux.'],
          ['Server-PT', 'Servicios, Configuración IP, Terminal Linux y Símbolo del sistema.'],
        ]),
        note('Las ventanas se mueven por la cabecera y cambian de tamaño desde la esquina. Escape cierra la ventana activa (salvo dentro de nano o vim).'),
      ],
    },
    {
      id: 'usuarios',
      title: 'Usuarios y contraseñas',
      summary: 'Cuentas de las terminales, de SSH y del correo en los laboratorios.',
      blocks: [
        p('Todas son credenciales de laboratorio, ficticias. Las cuentas SSH y de correo se cambian en la pestaña Servicios del servidor.'),
        h('Laboratorio «Server-PT: DHCP, DNS, web, correo y SSH»'),
        table(['Uso', 'Usuario', 'Contraseña', 'Dónde'], [
          ['Correo (IMAP)', 'ana → ana@aula.lab', 'ana1', 'Buzón en srv; cuenta configurada en el Correo de PC0'],
          ['Correo (POP3)', 'luis → luis@aula.lab', 'luis1', 'Buzón en srv; cuenta configurada en el Correo de PC1'],
          ['SSH', 'admin', 'cisco', 'ssh admin@srv.aula.lab o ssh admin@192.168.10.2'],
        ]),
        h('Cuentas de las terminales'),
        table(['Equipo', 'GNU/Linux', 'Windows'], [['PC', 'alumno', 'user'], ['Server-PT', 'admin', 'Administrator']]),
        h('Cuentas del sistema Linux de cada equipo'),
        table(['Cuenta', 'UID', 'Grupos', 'Notas'], [
          ['root', '0', 'root', 'Sin contraseña: su no permite entrar; usa sudo -i.'],
          ['alumno (PC) / admin (servidor)', '1000', 'alumno|admin, adm, sudo, users', 'Usuario de la terminal local. Puede usar sudo.'],
          ['Cuentas SSH del servidor', '1001–9999 (fijo por nombre)', 'propio, users', 'Una por cada usuario SSH; no están en el grupo sudo.'],
        ]),
        p('sudo pide la contraseña de la cuenta cuando existe una cuenta SSH con ese nombre (admin/cisco en el laboratorio) y la recuerda 15 minutos, como Ubuntu. En los PC no hay cuentas SSH, así que sudo no pide contraseña.'),
        code('admin@srv:~$ sudo systemctl restart apache2\n[sudo] password for admin:\nadmin@srv:~$ sudo -i\nroot@srv:~#'),
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
        code('1. Pulsa «Simulación».\n2. En un PC: Símbolo del sistema → ipconfig /release y ipconfig /renew\n   (o Terminal Linux → sudo dhclient -r eth0 && sudo dhclient eth0).\n3. Pulsa «Paso» y observa DISCOVER, OFFER, REQUEST y ACK.'),
      ],
    },
  ],
};
