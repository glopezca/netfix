/** Documentación: aplicaciones web de Server (Roundcube y gestión web). */
import type { DocPage } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const WEBAPP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-roundcube',
    title: 'Roundcube (correo web)',
    summary: 'Correo web sobre el IMAP y el SMTP del servidor, en un alias de Apache o en un puerto propio.',
    blocks: [
      p('Servicios → HTTP → Aplicaciones web: activa Roundcube y elige cómo se llega a él, para no ocupar el puerto 80 ni la raíz / de la web principal.'),
      table(['Acceso', 'URL desde un PC', 'Notas'], [
        ['Alias URL en Apache (por defecto /roundcube)', 'http://servidor/roundcube/', 'Lo sirve Apache: /etc/apache2/conf-enabled/roundcube.conf. Necesita el servicio HTTP activo.'],
        ['Puerto propio (por defecto 8080)', 'http://servidor:8080/', 'Escucha aunque Apache esté parado.'],
      ]),
      list(
        'Inicio de sesión con un usuario de correo del servidor (Servicios → Correo); necesita IMAP activo.',
        'Bandeja de entrada, Enviados y Papelera; leer, redactar, responder, reenviar y borrar.',
        'Los mensajes a otros dominios se entregan por SMTP al servidor MX que indique el DNS.',
        'La sesión va en la cookie roundcube_sessid; la configuración generada está en /etc/roundcube/config.inc.php.',
      ),
      note('Con DNS, un CNAME webmail → srv permite escribir http://webmail.aula.lab/roundcube/.'),
    ],
  },
  {
    id: 'srv-webadmin',
    title: 'Gestión web de Server',
    summary: 'Interfaz de administración con menú lateral y tarjetas: configuración básica, SSH, DHCP, DNS por modos, web, correo, estado, registros y ficheros.',
    blocks: [
      p('Servicios → HTTP → Aplicaciones web → Gestión web. Por defecto está desactivada; al activarla escucha en el puerto 10000 (o en un alias de Apache como /admin) con usuario admin y contraseña netfix (la misma cuenta que el SSH de los laboratorios).'),
      code('Navegador del PC:  http://srv.aula.lab:10000/\nTerminal:          curl -u admin:netfix "http://192.168.10.2:10000/?page=status"'),
      table(['Página', 'Qué cambia'], [
        ['Configuración', 'Nombre de host, IP estática o DHCP, puerta de enlace y DNS.'],
        ['SSH', 'El primero del menú Servicios: servicio, usuarios y métodos de autenticación (contraseña y/o par de claves) de sshd_config.'],
        ['DHCP', 'Activar el servidor, elegir las interfaces de escucha (interfaces-config de Kea), añadir y borrar pools (concesiones por MAC o por Client-ID), direcciones reservadas por MAC o identificador (hex 01… o texto) y «Reservar» una concesión activa.'],
        ['DNS', 'Interfaces de escucha (listen-on), tarjetas de los cinco modos (Caché, Agente de reenvío, Autoritativo, Recursivo, Iterativo) con su interruptor y usos, una pestaña de opciones por modo (el asistente de zonas SOA → NS → tipo → registros en Autoritativo) y, al lado, la configuración de BIND generada (named.conf.options, zonas, archivos) explicada.'],
        ['Web', 'Apache y el acceso a Roundcube.'],
        ['Enrutamiento (Router Linux)', 'Casilla «Activar router» (net.ipv4.ip_forward), parámetros del núcleo y rutas estáticas.'],
        ['Correo', 'Servicios y usuarios.'],
        ['Administración', 'Usuario/contraseña de la interfaz y su puerto o alias (al cambiarlo, el navegador pasa a la nueva dirección).'],
        ['Estado · Configuración · Registros', 'Datos del equipo, servicios, concesiones, los ficheros de configuración de cada servicio tal como están, con la sintaxis resaltada como en vim (solo Linux), y los últimos mensajes (journalctl).'],
      ]),
      h('Seguridad'),
      list(
        'Autenticación HTTP Basic (realm «Server»); los intentos fallidos quedan en journalctl -u apache2.',
        'Cada cambio se valida igual que en la ventana del servidor y se registra con el usuario y la IP del PC.',
        'El apartado Seguridad del menú (Enrutamiento, Firewall, VPN) solo aparece en el Router Linux; en un Server no existe.',
      ),
    ],
  },
];
