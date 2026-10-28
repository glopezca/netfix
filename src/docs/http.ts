/** Documentación: el servicio HTTP de Server (Apache2 o IIS), en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, code, exercise, figure, h, list, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const HTTP_DOCS: readonly DocPage[] = [
  {
    id: 'srv-http',
    title: 'Servidor web',
    summary: 'Publicar páginas HTML desde el panel o desde /var/www/html y probarlas con el navegador y curl.',
    markdownBase: MD,
    blocks: [
      p('Un servidor web entrega páginas cuando un navegador las pide por HTTP (puerto 80). En un Server con Ubuntu el servicio es **Apache2**; con Windows Server, **IIS**. En los dos, **Servicios → HTTP** lista los ficheros del sitio (index.html, ayuda.html…) y permite crearlos, editarlos y borrarlos.'),
      figure({
        type: 'sequence',
        actors: ['PC0 (navegador)', 'SRV (bind9)', 'SRV (apache2)'],
        messages: [
          { from: 0, to: 1, text: 'www.aula.lab A?', note: 'DNS (53/udp)' },
          { from: 1, to: 0, text: '192.168.10.2' },
          { from: 0, to: 2, text: 'GET / HTTP/1.1', note: 'Host: www.aula.lab (80/tcp)' },
          { from: 2, to: 0, text: '200 OK', note: 'index.html' },
        ],
      }, 'Para abrir http://www.aula.lab el PC primero resuelve el nombre y después pide la página al puerto 80.'),
      h('Publicar una página'),
      steps(
        ['Activa el servicio', '**Servicios → HTTP**: el interruptor **Servicio HTTP (Apache2, puertos 80)**.'],
        ['Crea el fichero', 'En **Nuevo fichero** escribe un nombre como `hola.html` (o `docs/guia.html`, sin espacios) y pulsa **Crear**.'],
        ['Escribe el contenido', 'Selecciónalo en la lista, escribe el HTML en **Editar hola.html** y pulsa **Guardar**.'],
        ['Pruébalo', 'Desde un PC: **Navegador** con http://www.aula.lab/hola.html, o `curl` en la terminal.'],
      ),
      p('Una ruta que no existe devuelve **404 Not Found**. La cabecera Server dice Apache/2.4.62 (Ubuntu) o Microsoft-IIS/10.0 según el sistema del servidor. HTTPS no está simulado.'),
      check('Compruébalo con curl', '`curl -I` muestra solo las cabeceras de la respuesta: el código (200, 404…), el servidor y el tipo de contenido.'),
      term('shell', 'alumno@pc1:~$ curl -I http://www.aula.lab\nHTTP/1.1 200 OK\nDate: Sat, 24 Oct 2026 06:24:07 GMT\nServer: Apache/2.4.62 (Ubuntu)\nContent-Length: 400\nContent-Type: text/html; charset=UTF-8\nalumno@pc1:~$ curl -s -o /dev/null -w "%{http_code}\\n" http://www.aula.lab/noexiste\n404'),
      h('Desde la Terminal Linux del servidor'),
      p('/var/www/html es la misma carpeta que lista el panel: lo que se escribe ahí aparece en el panel y se sirve al momento. Pertenece a root, así que hace falta sudo.'),
      code('admin@srv:~$ sudo nano /var/www/html/index.html\nadmin@srv:~$ echo "<h1>Hola</h1>" | sudo tee /var/www/html/hola.html\nadmin@srv:~$ ls -l /var/www/html'),
      tip('Aplicaciones web', 'En el mismo panel, **Aplicaciones web** activa la **Gestión web del servidor** y **Roundcube (correo web)**, cada una en un alias de Apache (/admin, /roundcube) o en un puerto propio. Tienen su propia página en esta ayuda.'),
      warn('Errores habituales', '«This site can’t be reached» en el navegador: el servicio está parado, el nombre no resuelve (prueba con la dirección IP) o no hay ruta hasta el servidor. **403 Forbidden**: Apache no puede leer la carpeta (ver Apache2). Editar /var/www/html sin sudo: «Permission denied».'),
      exercise('Tu primera página', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», publica hola.html con un título `<h1>Hola</h1>` y ábrela desde PC0.', 'Servicios → HTTP → Nuevo fichero `hola.html` → Crear; escribe `<h1>Hola</h1>` y **Guardar**. En PC0 → Navegador: http://www.aula.lab/hola.html muestra «Hola». En la Terminal Linux de PC1, `curl http://www.aula.lab/hola.html` devuelve el mismo HTML.'),
    ],
  },
  {
    id: 'srv-apache',
    title: 'Apache2 en /etc/apache2',
    summary: 'La configuración real de Ubuntu paso a paso: sitios, módulos, puertos, VirtualHost, comprobación y recarga.',
    markdownBase: MD,
    blocks: [
      p('En un Server con Ubuntu, Apache 2.4 se configura como en Ubuntu, con los ficheros de **/etc/apache2** (como root o con sudo). El panel HTTP sigue editando /var/www/html, la carpeta del sitio por defecto (000-default.conf). En Windows Server el servicio es IIS y sirve esa misma lista de ficheros.'),
      table(['Fichero o carpeta', 'Para qué sirve'], [
        ['apache2.conf', 'Configuración principal: incluye el resto y define los <Directory> permitidos (/var/www y /usr/share).'],
        ['ports.conf', 'Puertos con Listen (80; 443 si se activa ssl).'],
        ['sites-available/ · sites-enabled/', 'Sitios (VirtualHost). Se activan con a2ensite y se desactivan con a2dissite.'],
        ['mods-available/ · mods-enabled/', 'Módulos (a2enmod / a2dismod): alias, dir, autoindex, rewrite, ssl, headers, userdir…'],
        ['conf-available/ · conf-enabled/', 'Fragmentos de configuración (a2enconf / a2disconf): security.conf, charset.conf…'],
      ]),
      h('Paso a paso: un segundo sitio con VirtualHost'),
      p('Con **VirtualHost por nombre**, un único servidor con una sola dirección IP atiende varios sitios: Apache elige el sitio por la cabecera Host que envía el navegador (ServerName o ServerAlias). Si ninguno coincide, responde el primero de ese puerto.'),
      steps(
        ['Crea la carpeta del sitio', '`sudo mkdir -p /var/www/empresa` y su `index.html`.'],
        ['Escribe el sitio', 'Un fichero nuevo en sites-available con el bloque `<VirtualHost *:80>`, su **ServerName** y su **DocumentRoot**.'],
        ['Actívalo', '`sudo a2ensite empresa` crea el enlace en sites-enabled.'],
        ['Comprueba la sintaxis', '`sudo apache2ctl configtest` debe acabar en **Syntax OK**. Si no, dice el fichero y la línea del error.'],
        ['Recarga Apache', '`sudo systemctl reload apache2`. Sin recargar, los cambios no se aplican.'],
        ['Da de alta el nombre', 'En **Servicios → DNS**, un registro `empresa` CNAME `srv` en aula.lab, para que los PC encuentren empresa.aula.lab.'],
      ),
      term('apache', '<VirtualHost *:80>\n    ServerName empresa.aula.lab\n    DocumentRoot /var/www/empresa\n    Alias /docs /srv/docs\n    Redirect /antigua http://www.aula.lab/\n</VirtualHost>'),
      term('shell', 'admin@srv:~$ sudo a2ensite empresa\n[sudo] password for admin:\nEnabling site empresa.\nTo activate the new configuration, you need to run:\n  systemctl reload apache2\nadmin@srv:~$ sudo apache2ctl configtest\nAH00558: apache2: Could not reliably determine the server\'s fully qualified domain name, using 127.0.1.1. Set the \'ServerName\' directive globally to suppress this message\nSyntax OK\nadmin@srv:~$ sudo systemctl reload apache2'),
      tip('El aviso AH00558', 'No es un error: Apache avisa de que no hay un ServerName global. Se quita con `ServerName srv.aula.lab` en apache2.conf. Lo que importa es la última línea, **Syntax OK**.'),
      check('Compruébalo desde un PC', 'Cada nombre lleva a su sitio aunque los dos apunten a la misma dirección IP. Con `curl -H "Host: …"` se prueba un sitio sin tener aún el nombre en el DNS.'),
      term('shell', 'alumno@pc1:~$ curl http://empresa.aula.lab/\n<h1>Empresa</h1>\nalumno@pc1:~$ curl -H "Host: empresa.aula.lab" http://192.168.10.2/\n<h1>Empresa</h1>'),
      h('Lo que conviene saber'),
      list(
        'Los cambios no se aplican hasta systemctl reload (sitios, conf) o restart (módulos, puertos). Si la configuración tiene errores, reload falla y Apache sigue con la anterior; restart lo deja parado.',
        'Permisos: Apache lee como www-data. Un DocumentRoot fuera de /var/www o /usr/share da 403 Forbidden hasta añadir <Directory …> Require all granted </Directory>. Sin index.html, Options Indexes muestra el listado del directorio («Index of /»).',
        'Directivas admitidas: Listen, VirtualHost, ServerName, ServerAlias, DocumentRoot, Alias, Redirect, DirectoryIndex, ErrorDocument, Options, Require, Include/IncludeOptional, IfModule, IfDefine… Las de un módulo desactivado dan «Invalid command».',
        'Los cambios en /etc/apache2 (también los ficheros borrados, como un sitio desactivado) se guardan con la topología.',
      ),
      warn('Errores habituales', 'Una directiva mal escrita: configtest da «AH00526: Syntax error on line 3 of …: Invalid command \'DocumentRot\'…». Olvidar el reload. Probar el sitio por su nombre sin haberlo dado de alta en el DNS: el navegador no lo encuentra.'),
      exercise('Corrige el sitio', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», crea el sitio empresa.aula.lab de los pasos, pero escribe `DocumentRot`. Encuentra el error, corrígelo y comprueba el sitio desde PC1.', '`sudo apache2ctl configtest` responde «AH00526: Syntax error on line 3 of /etc/apache2/sites-enabled/empresa.conf: Invalid command \'DocumentRot\'…». Corrige la línea (por ejemplo con `sudo nano /etc/apache2/sites-available/empresa.conf`), repite configtest (Syntax OK) y `sudo systemctl reload apache2`. Con el CNAME `empresa` → `srv`, `curl http://empresa.aula.lab/` en PC1 devuelve `<h1>Empresa</h1>`; www.aula.lab sigue mostrando el sitio por defecto.'),
    ],
  },
];
