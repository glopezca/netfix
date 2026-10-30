/** Documentación: la Terminal GNU/Linux (visión general, sistema de ficheros, programas y red), en estilo guiado. */
import type { DocBlock, DocPage } from './types.ts';
import { check, code, exercise, h, list, note, p, steps, table, term, tip, warn } from './types.ts';
import { UTIL_DOCS, UTIL_GROUPS } from './utils.ts';
import type { UtilDoc } from './utils.ts';

function utilityBlocks(groups: readonly UtilDoc['group'][]): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const g of groups) {
    const names = Object.keys(UTIL_DOCS).filter((n) => UTIL_DOCS[n]?.group === g).sort();
    blocks.push(h(UTIL_GROUPS[g]), table(['Programa', 'Uso', 'Descripción'], names.map((n) => [n, UTIL_DOCS[n]?.synopsis ?? '', UTIL_DOCS[n]?.summary ?? ''])));
    for (const n of names) {
      const o = UTIL_DOCS[n]?.options;
      if (o) blocks.push(p(`Opciones de ${n}:`), code(o));
    }
  }
  return blocks;
}

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const LINUX_DOCS: readonly DocPage[] = [
  {
    id: 'linux-intro',
    title: 'La Terminal GNU/Linux',
    summary: 'Ubuntu 26.04 con GNU bash 5.3 en cada PC y servidor: tu primera sesión, tu primer script y qué hay disponible.',
    markdownBase: MD,
    blocks: [
      p('Cada PC y cada Server tiene su propio sistema Ubuntu 26.04 simulado: un sistema de ficheros con permisos, cuentas de usuario, GNU bash 5.3.20 y las utilidades GNU más usadas (coreutils, grep, sed, mawk, find…), además de los programas de red que hablan con la red simulada (ip, ping, dig, curl, ssh…).'),
      code('alumno@pc0:~$ echo "Hola" > saludo.txt && cat saludo.txt\nHola\nalumno@pc0:~$ for h in srv www; do dig +short $h.aula.lab; done\nalumno@pc0:~$ ip -br a\nalumno@pc0:~$ sudo dhclient -r eth0 && sudo dhclient eth0\nalumno@pc0:~$ ssh admin@srv.aula.lab'),
      h('Paso a paso: tu primer script'),
      steps(
        ['Abre la terminal', 'Doble clic en un PC → **Terminal GNU/Linux**. El indicador `alumno@pc1:~$` dice usuario, equipo y directorio (~ es tu home).'],
        ['Mira dónde estás', '`pwd` y `ls -la` (con -a, también los ficheros ocultos que empiezan por punto).'],
        ['Escribe el script', '`nano saludo.sh` con dos líneas: `#!/bin/bash` y `echo "Hola, $USER, desde $(hostname)"`. Ctrl+O guarda y Ctrl+X sale.'],
        ['Dale permiso de ejecución', '`chmod +x saludo.sh`; sin él, `./saludo.sh` da «Permission denied».'],
        ['Ejecútalo', '`./saludo.sh`.'],
      ),
      term('shell', 'alumno@pc1:~$ cat saludo.sh\n#!/bin/bash\necho "Hola, $USER, desde $(hostname)"\nalumno@pc1:~$ ./saludo.sh\nbash: ./saludo.sh: Permission denied\nalumno@pc1:~$ chmod +x saludo.sh\nalumno@pc1:~$ ./saludo.sh\nHola, alumno, desde pc1'),
      h('Qué conviene saber'),
      list(
        'El shell es interactivo: lee /etc/bash.bashrc y ~/.bashrc, guarda el historial y muestra el prompt en color de Ubuntu.',
        'Los scripts funcionan: nano script.sh, chmod +x script.sh y ./script.sh (con #!/bin/bash), o bash script.sh.',
        'help muestra las órdenes internas y man la ayuda de cada programa; esta pestaña tiene la referencia completa.',
        'exit en la terminal local abre una sesión nueva; en una sesión SSH, la cierra.',
        'No hay gestor de paquetes (apt) ni procesos reales: los trabajos en segundo plano terminan al momento.',
      ),
      note('Todo lo que se escribe en el disco del equipo (home, scripts, cambios en /etc) se guarda con la topología.'),
      tip('Tab y las flechas', 'Tab completa nombres de órdenes y ficheros; ↑ y ↓ recorren el historial; Ctrl+R lo busca. Escribir menos es equivocarse menos.'),
      warn('Errores habituales', 'Escribir `saludo.sh` en vez de `./saludo.sh`: el directorio actual no está en el PATH («command not found»). Usar comillas dobles con `!` dentro en la terminal: bash intenta expandir el historial («event not found»); usa comillas simples. Olvidar `sudo` para tocar ficheros del sistema.'),
      note('Casilla «Prompt con marca de fecha y hora» (al pie de la terminal): es como ejecutar PS1="\\[\\e[32m\\]\\d \\[\\e[36m\\]\\A \\[\\e[33m\\]\\u@\\h:\\w\\$ \\[\\e[0m\\]": fecha en verde, hora en cian y usuario@equipo:ruta en amarillo, con la hora simulada. Es un ajuste general de este navegador, desactivado por defecto (también en Configuración → Generales): vale para todas las terminales GNU/Linux y Windows y para las sesiones SSH; al desmarcarla vuelve el PS1 que había. Un bash o su anidado lee su .bashrc, como en Ubuntu. En un aula puede estar bloqueada por el profesor.'),
      exercise('Un script que informa', 'En PC1 del laboratorio «Server: DHCP, DNS, web, correo y SSH», crea `info.sh` que muestre el nombre del equipo, su dirección IP y su puerta de enlace, y ejecútalo.', 'Contenido: `#!/bin/bash`, `echo "Equipo: $(hostname)"`, `echo "Dirección IP: $(hostname -I)"` y `echo "Puerta de enlace: $(ip r | grep default | cut -d" " -f3)"`. Después `chmod +x info.sh` y `./info.sh` muestra pc1, 192.168.10.50 y 192.168.10.1.'),
    ],
  },
  {
    id: 'linux-ficheros',
    title: 'Sistema de ficheros y permisos',
    summary: 'Árbol de directorios, ficheros generados por la simulación, /var/www/html y cómo leer y cambiar permisos.',
    markdownBase: MD,
    blocks: [
      table(['Ruta', 'Contenido'], [
        ['/home/alumno · /home/admin · /root', 'Directorios personales (.bashrc, .profile, .bash_history)'],
        ['/etc/passwd · /etc/group · /etc/shadow', 'Cuentas del equipo, generadas a partir de las cuentas SSH (shadow solo para root)'],
        ['/etc/hostname · /etc/resolv.conf · /etc/netplan/50-cloud-init.yaml', 'Generados: siguen la configuración IP del equipo (resolv.conf incluye «search» con los dominios de netplan y de DHCP)'],
        ['/etc/hosts', 'Archivo normal que edita root (sudo nano /etc/hosts): ping, ssh, curl, el navegador y la Terminal Windows (que comparte el sistema de archivos GNU/Linux) lo consultan antes que el DNS; nslookup, host y dig preguntan solo al servidor DNS. hostname -f da el primer nombre de la línea del equipo. Se guarda con la topología.'],
        ['/etc/kea · /etc/bind · /etc/postfix · /etc/dovecot · /etc/ssh/sshd_config', 'Generados en servidores: siguen la pestaña Servicios'],
        ['/var/lib/kea/kea-leases4.csv', 'Concesiones DHCP actuales'],
        ['/var/www/html', 'Las páginas del servidor web (lectura y escritura con sudo)'],
        ['/usr/bin · /usr/sbin', 'Programas'],
        ['/tmp', 'Temporal (todos pueden escribir; bit sticky)'],
        ['/dev/null · /dev/zero · /dev/random · /dev/tty', 'Dispositivos'],
        ['/proc/version · /proc/cpuinfo · /proc/meminfo', 'Información del sistema'],
      ]),
      p('Los ficheros generados son de solo lectura («Read-only file system»): se cambian desde la interfaz (TCP/IP, Servicios) y la terminal los ve al momento.'),
      h('Permisos'),
      p('Cada fichero tiene un **dueño**, un **grupo** y tres tríos de permisos: **r** (leer), **w** (escribir) y **x** (ejecutar, o entrar si es un directorio), para el dueño, el grupo y los demás.'),
      table(['Columna de ls -l', 'Ejemplo', 'Significa'], [
        ['Tipo y permisos', '-rw-r-----', 'Fichero (-); el dueño lee y escribe; el grupo lee; los demás, nada.'],
        ['Dueño · grupo', 'root shadow', 'Solo root y el grupo shadow pueden leerlo.'],
        ['En octal', '640', 'r=4, w=2, x=1 sumados por trío: 6 (rw-), 4 (r--), 0 (---).'],
      ]),
      term('shell', 'alumno@pc1:~$ ls -l /etc/shadow\n-rw-r----- 1 root shadow 67 Oct 24 10:44 /etc/shadow\nalumno@pc1:~$ cat /etc/shadow\ncat: /etc/shadow: Permission denied\nalumno@pc1:~$ echo x > /etc/resolv.conf\nbash: /etc/resolv.conf: Read-only file system'),
      code('$ chmod 750 script.sh      # rwxr-x---\n$ chmod u+x,go-w script.sh\n$ umask 022\n$ sudo chown root:root f'),
      list(
        'Se comprueban lectura, escritura y ejecución para dueño, grupo y otros, el bit sticky de /tmp y la ejecución en directorios.',
        'root puede leer y escribir todo salvo los ficheros generados.',
        'Límites: 256 KiB por fichero y 4 MiB por equipo («File too large», «No space left on device»).',
      ),
      warn('Permission denied o Read-only file system', 'Son errores distintos. «Permission denied»: tu usuario no tiene permiso (mira `ls -l` y usa sudo si procede). «Read-only file system»: es un fichero generado por Netfix, ni root lo cambia; se cambia en la interfaz (TCP/IP, Servicios).'),
      exercise('Un script privado', 'En PC1, deja `saludo.sh` (de «La Terminal GNU/Linux») para que tú puedas leerlo, cambiarlo y ejecutarlo, tu grupo solo leerlo, y los demás nada. ¿Qué número octal usas?', '750 no: el grupo podría ejecutarlo. Es `chmod 740 saludo.sh`: 7 (rwx) para ti, 4 (r--) para el grupo y 0 para los demás. `ls -l saludo.sh` muestra `-rwxr-----`.'),
    ],
  },
  {
    id: 'linux-programas',
    title: 'Programas de la Terminal GNU/Linux',
    summary: 'Todas las utilidades disponibles con sus opciones, y cómo encadenarlas con tuberías.',
    markdownBase: MD,
    blocks: [
      p('Cada programa acepta las opciones habituales de GNU y produce sus mensajes de error. man PROGRAMA muestra esta misma información en la terminal.'),
      tip('Encadena programas', 'La fuerza de GNU/Linux está en combinar programas pequeños con `|` (tubería): la salida de uno es la entrada del siguiente. `grep bash /etc/passwd | cut -d: -f1` lista las cuentas que usan bash.'),
      term('shell', 'alumno@pc1:~$ grep bash /etc/passwd | cut -d: -f1\nroot\nalumno\nalumno@pc1:~$ grep -c bash /etc/passwd\n2'),
      exercise('¿Cuántas cuentas hay?', 'En SRV del laboratorio «Server: DHCP, DNS, web, correo y SSH», cuenta las líneas de /etc/passwd y lista solo los nombres de las cuentas que tienen su home en /home.', '`wc -l /etc/passwd` cuenta 4 líneas. `grep :/home/ /etc/passwd | cut -d: -f1` muestra solo admin: es la cuenta de la terminal y también la única cuenta SSH del laboratorio (cada cuenta SSH nueva tendría su /home).'),
      ...utilityBlocks(['ficheros', 'texto', 'sistema', 'shell', 'editores']),
    ],
  },
  {
    id: 'linux-red',
    title: 'Red y servicios desde GNU/Linux',
    summary: 'Diagnosticar la red en cuatro pasos, y la referencia de ip, ping, dig, resolvectl, curl, wget, ssh, dhclient, ss, systemctl y journalctl.',
    markdownBase: MD,
    blocks: [
      h('Paso a paso: ¿por qué no tengo red?'),
      steps(
        ['¿Tengo dirección IP?', '`ip -br a`: la interfaz debe estar UP y con su dirección IP. Si sale 169.254.x.x o nada, el problema es DHCP o el cable.'],
        ['¿Tengo puerta de enlace?', '`ip r`: debe haber una línea «default via …».'],
        ['¿Llego a la puerta de enlace?', '`ping -c 1` a esa dirección IP. Si no responde, el problema está en la red local.'],
        ['¿Resuelvo nombres?', '`dig +short` de un nombre conocido. Si no responde pero el ping a una dirección IP sí, el problema es el DNS.'],
      ),
      term('shell', 'alumno@pc1:~$ ip -br a\nlo               UNKNOWN        127.0.0.1/8\neth0             UP             192.168.10.50/24\nalumno@pc1:~$ ip r\ndefault via 192.168.10.1 dev eth0 proto dhcp metric 100\n192.168.10.0/24 dev eth0 proto kernel scope link src 192.168.10.50\nalumno@pc1:~$ ping -c 1 192.168.10.1\nPING 192.168.10.1 (192.168.10.1) 56(84) bytes of data.\n64 bytes from 192.168.10.1: icmp_seq=1 ttl=255 time=0.400 ms\nalumno@pc1:~$ dig +short srv.aula.lab\n192.168.10.2'),
      check('Lee los TTL', 'El ttl de la respuesta delata al equipo: 255 un Cisco, 64 un GNU/Linux, 128 un Windows (menos uno por cada router que atraviesa).'),
      ...utilityBlocks(['red', 'servicios']),
      h('Ejemplos'),
      code('$ ip r\ndefault via 192.168.10.1 dev eth0 proto dhcp metric 100\n$ dig +short www.aula.lab\nsrv.aula.lab.\n192.168.10.2\n$ resolvectl query www.aula.lab\nwww.aula.lab: 192.168.10.2                  -- link: eth0\n                (srv.aula.lab)\n$ resolvectl dns\nGlobal:\nLink 2 (eth0): 192.168.10.2\n$ curl -I http://www.aula.lab\nHTTP/1.1 200 OK\nServer: Apache/2.4.62 (Ubuntu)\n$ ping -c 1 noexiste.aula.lab\nping: noexiste.aula.lab: Name or service not known\n$ systemctl stop apache2\nFailed to stop apache2.service: Interactive authentication required.'),
      exercise('Rompe y arregla', 'En PC1 del laboratorio «Server: DHCP, DNS, web, correo y SSH», quita el servidor DNS de su configuración (TCP/IP → Estática, sin servidor DNS) y sigue el paso a paso. ¿En qué paso falla?', 'Los pasos 1 a 3 funcionan (dirección IP, «default via 192.168.10.1» y ping a la puerta de enlace), pero `dig +short srv.aula.lab` acaba en «;; no servers could be reached» y `ping srv.aula.lab` dice «Temporary failure in name resolution»: falla el DNS. Vuelve a poner 192.168.10.2 (o DHCP).'),
    ],
  },
];
