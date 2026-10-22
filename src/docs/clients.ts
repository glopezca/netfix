/** Documentación: equipos cliente (configuración IP, aplicaciones y Terminal Windows). */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const CLIENT_DOCS: DocGroup = {
  id: 'clientes',
  title: 'PC y Windows',
  pages: [
    {
      id: 'pc-ip',
      title: 'Configuración IP',
      summary: 'IP estática o por DHCP, sistema operativo, MAC y Client-ID.',
      blocks: [
        list(
          'Estática: dirección, máscara (255.255.255.0 o /24), puerta de enlace y servidor DNS.',
          'DHCP: el equipo pide la configuración (DORA) y muestra la concesión obtenida.',
          'Sistema operativo: Ubuntu o Windows. Cambia la terminal que se abre primero y el sistema que ve un cliente SSH.',
        ),
        h('Client-ID (opción 61)'),
        table(['Opción', 'Qué envía'], [
          ['«Enviar identificador de cliente» activado (por defecto)', '01 + MAC, como Windows.'],
          ['Desactivado', 'Nada: el servidor identifica al cliente por la MAC.'],
          ['Client-ID personalizado (hexadecimal)', 'Los bytes indicados, p. ej. 0100.50f0.0000.02.'],
          ['Client-ID personalizado (texto ASCII)', 'El texto como bytes, p. ej. PC-profesor.'],
        ]),
      ],
    },
    {
      id: 'pc-equipo',
      title: 'Nombre del equipo',
      summary: 'Nombre visible, nombre de host y nombre descriptivo; equivalencias en Linux y Windows.',
      blocks: [
        p('La pestaña Equipo de PCs y servidores separa dos nombres: el nombre visible (la etiqueta del icono en el área de trabajo) y el nombre de host del sistema. El nombre de host lo envía el cliente DHCP (opción 12, visible en show ip dhcp binding y en Kea), aparece en el prompt de GNU/Linux, en /etc/hostname y en hostname, y se guarda con la topología.'),
        table(['Dónde', 'Cómo se cambia', 'Persistente'], [
          ['Pestaña Equipo', 'Nombre de host + Guardar', 'Sí'],
          ['GNU/Linux', 'sudo hostnamectl set-hostname NOMBRE', 'Sí (/etc/hostname)'],
          ['GNU/Linux', 'echo NOMBRE | sudo tee /etc/hostname', 'Sí'],
          ['GNU/Linux', 'sudo hostname NOMBRE', 'No: nombre transitorio hasta reiniciar'],
          ['GNU/Linux', 'sudo hostnamectl set-hostname --pretty "Texto libre"', 'Sí (nombre descriptivo)'],
        ]),
        code('admin@srv:~$ hostnamectl set-hostname web01\n==== AUTHENTICATING FOR org.freedesktop.hostname1.set-static-hostname ====\nAuthentication is required to set the statically configured local hostname, as well as the pretty hostname.\nAuthenticating as: admin\nPassword:\n==== AUTHENTICATION COMPLETE ====\nadmin@srv:~$ exec bash\nadmin@web01:~$ hostnamectl | head -1\n Static hostname: web01'),
        list(
          'Como en Ubuntu, bash lee el nombre al arrancar: el prompt cambia en una shell nueva (exec bash o una terminal nueva).',
          'Reglas (RFC 1123): letras sin tilde, números y guiones; partes de hasta 63 caracteres separadas por puntos; sin espacios.',
        ),
      ],
    },
    {
      id: 'pc-apps',
      title: 'Navegador y correo',
      summary: 'Aplicaciones de escritorio del PC.',
      blocks: [
        list(
          'Navegador: http://IP o http://nombre. Resuelve por DNS, sigue los enlaces y dibuja la página de forma segura, sin ejecutar scripts.',
          'Correo: cuenta con servidor entrante (POP3 o IMAP) y saliente (SMTP). Redactar, Enviar y Recibir. POP3 borra del servidor; IMAP deja copia.',
        ),
      ],
    },
    {
      id: 'windows-cmd',
      title: 'Terminal Windows (cmd)',
      summary: 'Órdenes de cmd.exe disponibles en PCs y servidores Windows, también sobre los archivos del equipo.',
      blocks: [
        p('La Terminal Windows trabaja sobre el mismo sistema de archivos que la Terminal Linux del equipo: la unidad C:\\ es la raíz /, las carpetas se separan con \\ (o /) y los nombres no distinguen mayúsculas. Empieza en la carpeta personal de la cuenta Linux (C:\\home\\alumno en los PC, C:\\home\\admin en los servidores) y respeta sus permisos: lo que esa cuenta no puede escribir da «Access is denied.».'),
        note('Casilla «Prompt con marca de fecha y hora» (al pie de la terminal): el prompt pasa a ser el de esta función prompt de PowerShell: fecha y hora (Get-Date "ddd MMM dd" y "HH:mm:ss") en cian oscuro, usuario@equipo en verde, la ruta en amarillo y $ (# si la cuenta es de administrador). Por ejemplo: Thu Oct 22 18:28:05 user@pc0 C:\\home\\alumno$. La comparte con la Terminal Linux del equipo.'),
        table(['Orden', 'Uso'], [
          ['ipconfig [/all]', 'Configuración IP; /all añade MAC, servidor DHCP, DNS y fechas de la concesión.'],
          ['ipconfig /release · ipconfig /renew', 'Libera o renueva la concesión DHCP.'],
          ['ping [-n N] destino', 'Eco ICMP (4 por defecto).'],
          ['tracert [-h N] destino', 'Ruta salto a salto (ver «traceroute y tracert»).'],
          ['arp -a · arp -d', 'Muestra o borra la caché ARP.'],
          ['nslookup nombre [servidor]', 'Consulta DNS.'],
          ['netstat -an', 'Puertos a la escucha y conexiones.'],
          ['curl [-I] URL', 'Cliente HTTP.'],
          ['ssh usuario@host', 'Cliente SSH (también a servidores Ubuntu: abre bash).'],
          ['sc query [svc] · sc start|stop svc', 'Servicios de Windows Server (W3SVC, DNS, DHCPServer, SMTPSVC, POP3Svc, sshd).'],
          ['net start [svc] · net stop svc', 'Igual que sc, con los mensajes de net.'],
          ['hostname · whoami · ver · cls · help', 'Sistema y ayuda.'],
          ['cd [carpeta] · cd ..', 'Cambia de carpeta; sin argumento muestra la actual.'],
          ['dir [ruta] [/b]', 'Lista una carpeta (admite * y ?); /b solo los nombres.'],
          ['md carpeta · rd [/s] [/q] carpeta', 'Crea carpetas (también las intermedias) o las borra; /s con su contenido, tras preguntar «Are you sure (Y/N)?» salvo con /q.'],
          ['del [/q] archivo · copy [/y] origen destino · move [/y] origen destino · ren archivo nombre', 'Borra, copia, mueve o renombra archivos (admiten * y ?; *.* es todo). del de una carpeta o de *.* pregunta antes salvo /q; copy y move preguntan antes de sobrescribir salvo /y; copy de varios archivos sobre uno los une; move también mueve o renombra carpetas.'],
          ['type archivo', 'Muestra el contenido de un archivo.'],
          ['edit archivo', 'Editor a pantalla completa (Microsoft Edit): Ctrl+S guarda, Ctrl+Q o Esc sale y pregunta si hay cambios, Ctrl+F busca (F3 siguiente), Ctrl+G va a una línea, Ctrl+Z/Ctrl+Y deshacen y rehacen. F10 (también en la barra táctil) o Alt+letra abren los menús File, Edit, View y Help: la letra resaltada de cada menú y de cada opción es la que la elige; flechas para moverse, Intro para elegir y Esc para cerrar. Un archivo que la cuenta no puede escribir se abre en solo lectura.'],
          ['echo texto · orden > archivo · orden >> archivo', 'echo imprime el texto (echo. una línea en blanco); > guarda la salida de cualquier orden en un archivo, >> la añade al final y > nul la descarta.'],
        ]),
        code('C:\\home\\alumno> ipconfig /all > red.txt\nC:\\home\\alumno> type red.txt\nC:\\home\\alumno> edit notas.txt\nC:\\home\\alumno> copy notas.txt \\tmp\nC:\\home\\alumno> ssh admin@192.168.10.2'),
        p('Lo que se crea aquí aparece en la Terminal Linux (cat ~/red.txt, nano ~/notas.txt) y al revés.'),
        p('Los errores imitan Windows: «… is not recognized as an internal or external command», «Request timed out.», «FAILED 1060»…'),
      ],
    },
  ],
};
