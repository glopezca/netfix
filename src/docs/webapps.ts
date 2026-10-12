/** Documentación: aplicaciones web de Server-PT (Roundcube y gestión web). */
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
    title: 'Gestión web de Server-PT',
    summary: 'Interfaz de administración tipo router doméstico: configuración básica, DHCP, DNS, web, correo, SSH, estado y registros.',
    blocks: [
      p('Servicios → HTTP → Aplicaciones web → Gestión web. Por defecto está desactivada; al activarla escucha en el puerto 10000 (o en un alias de Apache como /admin) con usuario admin y contraseña admin.'),
      code('Navegador del PC:  http://srv.aula.lab:10000/\nTerminal:          curl -u admin:admin "http://192.168.10.2:10000/?page=status"'),
      table(['Página', 'Qué cambia'], [
        ['Configuración', 'Nombre de host, IP estática o DHCP, puerta de enlace y DNS.'],
        ['DHCP', 'Activar el servidor, añadir y borrar pools.'],
        ['DNS', 'Activar bind9, dominio de la zona y registros (A, CNAME, MX, NS, TXT; @ y * admitidos).'],
        ['Web', 'Apache y el acceso a Roundcube.'],
        ['Correo · SSH', 'Servicios y usuarios.'],
        ['Administración', 'Usuario/contraseña de la interfaz y su puerto o alias (al cambiarlo, el navegador pasa a la nueva dirección).'],
        ['Estado · Registros', 'Datos del equipo, servicios, concesiones y últimos mensajes (journalctl).'],
      ]),
      h('Seguridad'),
      list(
        'Autenticación HTTP Basic (realm «Server-PT»); los intentos fallidos quedan en journalctl -u apache2.',
        'Cada cambio se valida igual que en la ventana del servidor y se registra con el usuario y la IP del PC.',
      ),
    ],
  },
];
