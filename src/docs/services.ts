/** Documentación: servicios de Server-PT (DHCP, DNS, HTTP, correo, SSH) y su equivalente en Ubuntu y Windows. */
import type { DocGroup } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const SERVICE_DOCS: DocGroup = {
  id: 'servicios',
  title: 'Servicios de Server-PT',
  pages: [
    {
      id: 'srv-intro',
      title: 'Server-PT',
      summary: 'Pestañas del servidor, sistema operativo y nombres de los servicios.',
      blocks: [
        p('Un Server-PT es un equipo con servicios de red. Cada servicio tiene su interruptor y su panel en la pestaña Servicios; los cambios se aplican al momento y se reflejan en los ficheros de configuración que ve la Terminal Linux.'),
        table(['Servicio', 'Puerto', 'Unidad systemd (Ubuntu)', 'Servicio de Windows', 'Configuración en Linux'], [
          ['DHCP', '67/udp', 'kea-dhcp4-server', 'DHCPServer', '/etc/kea/kea-dhcp4.conf, /var/lib/kea/kea-leases4.csv'],
          ['DNS', '53/udp', 'bind9 (named)', 'DNS', '/etc/bind/named.conf.local, /etc/bind/db.<zona>'],
          ['HTTP', '80/tcp', 'apache2', 'W3SVC', '/var/www/html (editable)'],
          ['SMTP', '25/tcp', 'postfix', 'SMTPSVC', '/etc/postfix/main.cf'],
          ['POP3 / IMAP', '110 / 143', 'dovecot', 'POP3Svc', '/etc/dovecot/dovecot.conf'],
          ['SSH', '22/tcp', 'ssh', 'sshd', '/etc/ssh/sshd_config'],
        ]),
        h('Gestionar los servicios desde la terminal'),
        code('admin@srv:~$ systemctl status apache2\nadmin@srv:~$ sudo systemctl stop apache2\nadmin@srv:~$ sudo systemctl enable --now bind9\nadmin@srv:~$ journalctl -u kea-dhcp4-server -n 20\nadmin@srv:~$ ss -tulpn\n\nC:\\> sc query W3SVC\nC:\\> net stop DNS'),
        note('Sin sudo, systemctl start/stop/restart/enable/disable responde «Interactive authentication required», como en Ubuntu.'),
      ],
    },
    {
      id: 'srv-dhcp',
      title: 'DHCP de Server-PT',
      summary: 'Pools al estilo Packet Tracer, reservas y asignación automática por MAC o Client-ID.',
      blocks: [
        p('Cada pool se define como en Packet Tracer: IP inicial + número máximo de usuarios dentro de una subred, con puerta de enlace, servidor DNS, dominio, servidor TFTP y concesión en minutos (o infinita).'),
        h('Reservas'),
        p('Selecciona un pool y añade reservas: una IP fija para un cliente identificado por su dirección MAC o por su Client-ID (opción 61), con un nombre opcional. La IP debe estar en la subred del pool; no se admiten IP ni identificadores repetidos.'),
        table(['Campo', 'Formato'], [
          ['MAC', '0001.42AB.CDEF o 00:01:42:ab:cd:ef'],
          ['Client-ID', 'Hexadecimal con o sin puntos (0100.0142.abcd.ef); el típico de Windows es 01 + MAC'],
        ]),
        h('Asignaciones automáticas'),
        p('«Identificar concesiones automáticas por» decide qué identifica a un cliente que no tiene reserva:'),
        list(
          'Client-ID (opción 61) o, si no la envía, MAC: el comportamiento normal de DHCP (RFC 2131) y de kea por defecto.',
          'MAC: ignora el Client-ID; el mismo equipo conserva su IP aunque cambie de sistema o de Client-ID (kea: "match-client-id": false).',
        ),
        p('En la tabla de concesiones, los botones «Reservar por MAC» y «Reservar por Client-ID» convierten una concesión automática en reserva.'),
        code('"reservations": [\n  { "hw-address": "00:50:f0:00:00:02", "ip-address": "192.168.10.50" },\n  { "client-id": "01:00:50:f0:00:00:03", "ip-address": "192.168.10.51" }\n],\n"match-client-id": false'),
      ],
    },
    {
      id: 'srv-dns',
      title: 'DNS de Server-PT',
      summary: 'Registros, nombres relativos y absolutos, dominio de la zona ($ORIGIN) y respuestas.',
      blocks: [
        p('El servidor es autoritativo para las zonas de sus registros. Responde NOERROR con los datos, NXDOMAIN (con el SOA en AUTHORITY) si el nombre no existe en su zona y REFUSED si la consulta es de otra zona. Los PTR de los registros A se generan solos.'),
        table(['Tipo', 'Valor', 'Ejemplo'], [
          ['A', 'Dirección IPv4', 'srv → 192.168.10.2'],
          ['CNAME', 'Nombre canónico', 'www → srv'],
          ['MX', 'Servidor de correo + prioridad', 'aula.lab. → 10 srv'],
          ['NS', 'Servidor de nombres', '@ → srv'],
          ['TXT', 'Texto', '@ → "v=spf1 mx -all"'],
        ]),
        h('Nombres relativos y absolutos'),
        p('Con un dominio de la zona ($ORIGIN), por ejemplo aula.lab, los nombres se escriben como en un fichero de zona de BIND:'),
        table(['Escribes', 'Significa', 'Por qué'], [
          ['www', 'www.aula.lab.', 'Relativo: se autocompleta con el dominio.'],
          ['@', 'aula.lab.', 'El propio dominio.'],
          ['srv.aula.lab.', 'srv.aula.lab.', 'Absoluto: acaba en punto y no se toca.'],
          ['ftp.otra.lab.', 'ftp.otra.lab.', 'Absoluto de otra zona: el servidor también la sirve.'],
          ['srv.aula.lab', 'srv.aula.lab.aula.lab.', 'Error típico: sin punto final es relativo.'],
          ['*', '*.aula.lab.', 'Comodín: responde a cualquier nombre de la zona que no exista.'],
          ['*.dev', '*.dev.aula.lab.', 'Comodín de un subdominio: app.dev.aula.lab, api.dev.aula.lab…'],
        ]),
        p('Lo mismo vale para los valores de CNAME, MX y NS: «www CNAME @» o «@ MX 10 @» apuntan al propio dominio. El formulario muestra el nombre completo (FQDN) resultante antes de guardar. Sin dominio de la zona, todos los nombres se tratan como absolutos.'),
        h('Registros comodín'),
        list(
          'El comodín solo se usa si el nombre preguntado no existe: un nombre con registros propios (o con registros por debajo, como b.c.aula.lab si existe a.b.c.aula.lab) responde NOERROR sin datos para los tipos que no tiene.',
          'Se busca en el «encerrador más cercano» (RFC 4592): con *.aula.lab y srv.aula.lab, la consulta x.srv.aula.lab da NXDOMAIN, porque srv.aula.lab existe y no tiene *.srv.aula.lab.',
          'La respuesta lleva el nombre preguntado como propietario; un comodín CNAME se sigue como cualquier CNAME.',
          '«*» solo puede ser la primera etiqueta del nombre y nunca un valor; los comodines no generan PTR.',
        ),
        code('*      IN  A      192.168.10.80   ; cualquier.aula.lab → .80\n*.dev  IN  CNAME  srv             ; app.dev.aula.lab → srv.aula.lab\n@      IN  MX     10 @'),
        code('$ORIGIN aula.lab.\n$TTL 86400\n@\tIN\tSOA\tsrv.aula.lab. hostmaster.aula.lab. ( … )\n@\tIN\tNS\tsrv\n@\tIN\tMX\t10 srv\nsrv\tIN\tA\t192.168.10.2\nwww\tIN\tCNAME\tsrv'),
        note('Compruébalo desde un PC: dig www.aula.lab, dig +short aula.lab MX, dig -x 192.168.10.2, nslookup o host.'),
      ],
    },
    {
      id: 'srv-http',
      title: 'Servidor web',
      summary: 'Ficheros HTML, /var/www/html y banners de Apache e IIS.',
      blocks: [
        p('El panel HTTP lista los ficheros del sitio (index.html, ayuda.html…) y permite crearlos, editarlos y borrarlos. Una ruta que no existe devuelve 404 Not Found. El banner es Apache/2.4.62 (Ubuntu) o Microsoft-IIS/10.0 según el sistema del servidor.'),
        h('Desde la Terminal Linux del servidor'),
        p('/var/www/html es la misma carpeta: lo que se escribe ahí aparece en el panel y se sirve al momento. Pertenece a root, así que hace falta sudo.'),
        code('admin@srv:~$ sudo nano /var/www/html/index.html\nadmin@srv:~$ echo "<h1>Hola</h1>" | sudo tee /var/www/html/hola.html\nadmin@srv:~$ ls -l /var/www/html'),
        p('Desde un PC: el Navegador, curl -I http://www.aula.lab o wget http://www.aula.lab/hola.html. HTTPS no está simulado.'),
      ],
    },
    {
      id: 'srv-apache',
      title: 'Apache2 en /etc/apache2',
      summary: 'Configuración real de Ubuntu: sitios, módulos, puertos, VirtualHost, Alias, permisos y recarga.',
      blocks: [
        p('En un Server-PT con Ubuntu, el servicio HTTP es Apache 2.4 y se configura como en Ubuntu, con los ficheros de /etc/apache2 (como root o con sudo). La pestaña Servicios → HTTP sigue editando /var/www/html, la carpeta del sitio por defecto. En Windows Server el servicio es IIS y sirve esa misma lista de ficheros.'),
        table(['Fichero o carpeta', 'Para qué sirve'], [
          ['apache2.conf', 'Configuración principal: incluye el resto y define los <Directory> permitidos (/var/www y /usr/share).'],
          ['ports.conf', 'Puertos con Listen (80; 443 si se activa ssl).'],
          ['sites-available/ · sites-enabled/', 'Sitios (VirtualHost). Se activan con a2ensite y se desactivan con a2dissite.'],
          ['mods-available/ · mods-enabled/', 'Módulos (a2enmod / a2dismod): alias, dir, autoindex, rewrite, ssl, headers, userdir…'],
          ['conf-available/ · conf-enabled/', 'Fragmentos de configuración (a2enconf / a2disconf): security.conf, charset.conf…'],
        ]),
        h('Ciclo de trabajo'),
        code('admin@srv:~$ sudo mkdir -p /var/www/empresa\nadmin@srv:~$ echo "<h1>Empresa</h1>" | sudo tee /var/www/empresa/index.html\nadmin@srv:~$ sudo nano /etc/apache2/sites-available/empresa.conf\n<VirtualHost *:80>\n    ServerName empresa.aula.lab\n    DocumentRoot /var/www/empresa\n    Alias /docs /srv/docs\n    Redirect /antigua http://www.aula.lab/\n</VirtualHost>\nadmin@srv:~$ sudo a2ensite empresa\nadmin@srv:~$ sudo apache2ctl configtest\nSyntax OK\nadmin@srv:~$ sudo systemctl reload apache2\nalumno@pc0:~$ curl http://empresa.aula.lab/'),
        list(
          'Los cambios no se aplican hasta systemctl reload (sitios, conf) o restart (módulos, puertos). Si la configuración tiene errores, reload falla y Apache sigue con la anterior; restart lo deja parado.',
          'apache2ctl configtest muestra el error con el fichero y la línea: «AH00526: Syntax error on line 16 of …: Invalid command \'DocumentRot\'…».',
          'VirtualHost por nombre: Apache elige el sitio por la cabecera Host (ServerName o ServerAlias); si ninguno coincide, responde el primero de ese puerto. Necesitas el nombre en el DNS (o curl -H "Host: …").',
          'Permisos: Apache lee como www-data. Un DocumentRoot fuera de /var/www o /usr/share da 403 Forbidden hasta añadir <Directory …> Require all granted </Directory>. Sin index.html, Options Indexes muestra el listado del directorio.',
          'Directivas admitidas: Listen, VirtualHost, ServerName, ServerAlias, DocumentRoot, Alias, Redirect, DirectoryIndex, ErrorDocument, Options, Require, Include/IncludeOptional, IfModule, IfDefine… Las de un módulo desactivado dan «Invalid command».',
          'Los cambios en /etc/apache2 (también los ficheros borrados, como un sitio desactivado) se guardan con la topología.',
        ),
      ],
    },
    {
      id: 'srv-mail',
      title: 'Correo',
      summary: 'SMTP, POP3 e IMAP, dominio, cuentas y reenvío entre dominios por MX.',
      blocks: [
        list(
          'SMTP (25, postfix) recibe el correo; POP3 (110) e IMAP (143) con dovecot lo entregan. Cada protocolo se activa por separado.',
          'El dominio de correo (aula.lab) decide qué direcciones son locales; los usuarios tienen nombre y contraseña.',
          'Si el destinatario es de otro dominio, el servidor busca su MX por DNS y reenvía el mensaje (status=sent relay=…); si no puede, lo devuelve (bounced).',
          'POP3 borra los mensajes del servidor al descargarlos; IMAP deja copia.',
        ),
        code('admin@srv:~$ journalctl -u postfix\n… postfix/smtp[1402]: to=<bea@dos.lab>, relay=mail.dos.lab[10.0.0.2]:25, status=sent (250 2.0.0 Ok)'),
      ],
    },
    {
      id: 'srv-ssh',
      title: 'SSH',
      summary: 'Cuentas, sesiones remotas con bash y editores a través de SSH.',
      blocks: [
        p('Las cuentas SSH se definen en el panel (usuario y contraseña). Cada sesión abre una shell de inicio de sesión del servidor: bash en Ubuntu (lee ~/.profile y ~/.bashrc) o cmd en Windows. Las cuentas existen también en el sistema Linux del servidor (/etc/passwd y /home/<usuario>).'),
        code('alumno@pc0:~$ ssh admin@srv.aula.lab\nadmin@srv.aula.lab\'s password:\nWelcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)\nadmin@srv:~$ nano notas.txt        # el editor se abre a pantalla completa\nadmin@srv:~$ exit 3\nlogout\nConnection to srv.aula.lab closed.\nalumno@pc0:~$ echo $?\n3'),
        list(
          'Tres contraseñas erróneas: «Permission denied (publickey,password).»',
          'Servicio parado: «Connection refused»; nombre inexistente: «Could not resolve hostname».',
          'Ctrl+C y Ctrl+D se envían a la sesión remota.',
          'El servidor registra cada intento en journalctl -u ssh (Accepted / Failed password).',
        ),
      ],
    },
  ],
};
