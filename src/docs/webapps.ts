/** Documentación: aplicaciones web de Server (Roundcube y gestión web), en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, h, list, note, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const WEBAPP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-roundcube',
    title: 'Roundcube (correo web)',
    summary: 'Leer y escribir el correo desde el navegador, en un alias de Apache o en un puerto propio.',
    markdownBase: MD,
    blocks: [
      p('**Roundcube** es un correo web: los usuarios leen y escriben su correo desde el navegador, sin configurar ningún cliente. Por dentro usa el **IMAP** y el **SMTP** del mismo servidor, así que necesita el servicio de correo funcionando.'),
      h('Paso a paso'),
      steps(
        ['Actívalo', '**Servicios → HTTP → Aplicaciones web → Roundcube (correo web)**: **Activado**.'],
        ['Elige el acceso', '**Alias URL en Apache** (por defecto /roundcube) o **Puerto propio** (por defecto 8080), y **Aplicar**. Así no ocupa el puerto 80 ni la raíz / de la web principal.'],
        ['Entra', 'En el navegador de un PC, la URL del acceso elegido; inicia sesión con un usuario de **Servicios → Correo**.'],
      ),
      table(['Acceso', 'URL desde un PC', 'Notas'], [
        ['Alias URL en Apache', 'http://servidor/roundcube/', 'Lo sirve Apache: /etc/apache2/conf-enabled/roundcube.conf. Necesita el servicio HTTP activo.'],
        ['Puerto propio', 'http://servidor:8080/', 'Escucha aunque Apache esté parado.'],
      ]),
      list(
        'Bandeja de entrada, Enviados y Papelera; leer, redactar, responder, reenviar y borrar.',
        'Los mensajes a otros dominios se entregan por SMTP al servidor MX que indique el DNS.',
        'La sesión va en la cookie roundcube_sessid; la configuración generada está en /etc/roundcube/config.inc.php.',
      ),
      tip('Un nombre fácil', 'Con un CNAME `webmail` → `srv` en el DNS, los usuarios escriben http://webmail.aula.lab/roundcube/.'),
      check('Compruébalo con curl', 'Responde 200 OK desde Apache si el alias funciona.'),
      term('shell', 'alumno@pc1:~$ curl -sI http://webmail.aula.lab/roundcube/\nHTTP/1.1 200 OK\nDate: Sat, 24 Oct 2026 06:31:21 GMT\nServer: Apache/2.4.62 (Ubuntu)\nContent-Length: 682\nContent-Type: text/html; charset=UTF-8'),
      warn('Errores habituales', 'No inicia sesión: IMAP está apagado o el usuario no existe en Servicios → Correo. 404 en /roundcube/: el acceso está en un puerto propio, no en el alias. No carga nada con el alias: el servicio HTTP está parado.'),
      exercise('Luis lee el correo en la web', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», envía un correo de ana a luis desde PC0 y léelo con Roundcube desde el navegador de PC1.', 'PC0 → Correo → Redactar a luis@aula.lab → Enviar. En PC1 → Navegador: http://webmail.aula.lab/roundcube/, usuario luis y contraseña luis1: el mensaje está en la Bandeja de entrada. Si antes lo descargaste por POP3 con Recibir, ya no está en el servidor.'),
    ],
  },
  {
    id: 'srv-webadmin',
    title: 'Gestión web de Server',
    summary: 'Administrar el servidor desde el navegador: menú, páginas y seguridad de la interfaz.',
    markdownBase: MD,
    blocks: [
      p('La **gestión web** es una interfaz de administración en el navegador, como la de un router doméstico o un panel tipo Webmin: lo mismo que la pestaña Servicios, pero desde cualquier PC de la red. Cada cambio se valida igual que en la ventana del servidor y se aplica al momento.'),
      h('Paso a paso'),
      steps(
        ['Actívala', '**Servicios → HTTP → Aplicaciones web → Gestión web del servidor**: **Activado** (por defecto está desactivada). Escucha en el puerto 10000 o en un alias de Apache como /admin.'],
        ['Pon usuario y contraseña', 'Por defecto admin y netfix (la misma cuenta que el SSH de los laboratorios). Cámbialos en la página **Gestión**.'],
        ['Entra', 'En el navegador de un PC, http://srv.aula.lab:10000/ (o http://srv.aula.lab/admin/). El navegador pide usuario y contraseña.'],
      ),
      table(['Menú', 'Página', 'Qué cambia'], [
        ['Configuración', 'Configuración básica', 'Nombre de host (solo lectura), dirección IP estática o DHCP, puerta de enlace y DNS.'],
        ['Servicios', 'SSH', 'Servicio, usuarios y métodos de autenticación (contraseña y/o par de claves) de sshd_config.'],
        ['Servicios', 'DHCP', 'Servidor, interfaces de escucha, pools (concesiones por MAC o por Client-ID), reservas y «Reservar» una concesión activa.'],
        ['Servicios', 'DNS', 'Interfaces de escucha, tarjetas de los cinco modos con su interruptor y usos, el asistente de zonas y, al lado, la configuración de BIND generada, explicada.'],
        ['Servicios', 'Web y correo web', 'Apache y el acceso a Roundcube.'],
        ['Servicios', 'Correo', 'Protocolos, dominio y cuentas.'],
        ['Seguridad (Router Linux)', 'Enrutamiento · Firewall · VPN', 'Reenvío de paquetes y rutas estáticas, reglas nftables y WireGuard. En un Server no existe.'],
        ['Administración', 'Gestión', 'Usuario, contraseña y puerto o alias de la interfaz (al cambiarlo, el navegador pasa a la nueva dirección).'],
        ['Estado', 'Equipo · Configuración · Registros', 'Datos del equipo, servicios y concesiones; los ficheros de configuración con los colores de vim (solo Linux); los últimos mensajes (journalctl).'],
      ]),
      check('Compruébalo con curl', 'Sin credenciales responde **401 Unauthorized** con `Www-Authenticate: Basic realm="Server"`; con `-u usuario:contraseña`, la página.'),
      term('shell', 'alumno@pc1:~$ curl -s -u admin:netfix "http://192.168.10.2:10000/?page=status" | head -1\n<!doctype html>\nalumno@pc1:~$ curl -s -u admin:mal http://192.168.10.2:10000/ -o /dev/null -w "%{http_code}\\n"\n401'),
      h('Seguridad'),
      list(
        'Autenticación HTTP Basic (realm «Server»): el usuario y la contraseña viajan en cada petición sin cifrar (HTTPS no está simulado). En una red real, esta interfaz solo debe verse desde la red de administración.',
        'Los intentos fallidos y cada cambio quedan en el registro de apache2, con el usuario y la dirección IP del PC.',
      ),
      term('messages', 'Oct 24 06:31:28 srv apache2[903]: netfix-webui: acceso denegado para «admin» desde 192.168.10.50\nOct 24 06:31:28 srv apache2[903]: 192.168.10.50 - - "GET / HTTP/1.1" 401 191 (port 10000)'),
      note('El Router Linux tiene la misma gestión web, con el menú Seguridad; los routers y switches IOS tienen la suya, con otro aspecto.'),
      note('Lo que la pestaña Configuración del equipo o el laboratorio desactivan sale en gris en el menú, y su página solo lo avisa; con «Ocultar en la gestión web… las opciones desactivadas» (Configuración → Laboratorio actual) no aparece.'),
      exercise('¿Quién ha intentado entrar?', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», intenta entrar a la gestión web desde PC1 con una contraseña errónea y después con la buena. Busca los dos intentos en el servidor.', 'PC1 → Navegador → http://srv.aula.lab:10000/: con una contraseña errónea vuelve a pedirla. En SRV → Servicios → Registros → apache2 aparece «netfix-webui: acceso denegado para «admin» desde 192.168.10.50» y la petición con el código 401.'),
    ],
  },
];
