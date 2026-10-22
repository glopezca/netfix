/** Documentación: la Terminal Linux (visión general, sistema de ficheros y catálogo de programas). */
import type { DocBlock, DocPage } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';
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

export const LINUX_DOCS: readonly DocPage[] = [
  {
    id: 'linux-intro',
    title: 'La Terminal Linux',
    summary: 'Ubuntu 26.04 con GNU bash 5.3 en cada PC y servidor: qué hay y cómo se usa.',
    blocks: [
      p('Cada PC y cada Server tiene su propio sistema Ubuntu 26.04 simulado: un sistema de ficheros con permisos, cuentas de usuario, GNU bash 5.3.20 y las utilidades GNU más usadas (coreutils, grep, sed, mawk, find…), además de los programas de red que hablan con la red simulada (ip, ping, dig, curl, ssh…).'),
      code('alumno@pc0:~$ echo "Hola" > saludo.txt && cat saludo.txt\nHola\nalumno@pc0:~$ for h in srv www; do dig +short $h.aula.lab; done\nalumno@pc0:~$ ip -br a\nalumno@pc0:~$ sudo dhclient -r eth0 && sudo dhclient eth0\nalumno@pc0:~$ ssh admin@srv.aula.lab'),
      h('Qué conviene saber'),
      list(
        'El shell es interactivo: lee /etc/bash.bashrc y ~/.bashrc, guarda el historial y muestra el prompt en color de Ubuntu.',
        'Los scripts funcionan: nano script.sh, chmod +x script.sh y ./script.sh (con #!/bin/bash), o bash script.sh.',
        'help muestra las órdenes internas y man la ayuda de cada programa; esta pestaña tiene la referencia completa.',
        'exit en la terminal local abre una sesión nueva; en una sesión SSH, la cierra.',
        'No hay gestor de paquetes (apt) ni procesos reales: los trabajos en segundo plano terminan al momento.',
      ),
      note('Todo lo que se escribe en el disco del equipo (home, scripts, cambios en /etc) se guarda con la topología.'),
      note('Casilla «Prompt con marca de fecha y hora» (al pie de la terminal): es como ejecutar PS1="\\[\\e[32m\\]\\d \\[\\e[36m\\]\\A \\[\\e[33m\\]\\u@\\h:\\w\\$ \\[\\e[0m\\]": fecha en verde, hora en cian y usuario@equipo:ruta en amarillo, con la hora simulada. Es un ajuste del equipo (vale también para su Terminal Windows y para las sesiones SSH que se abren en él) y se guarda con la topología; al desmarcarla vuelve el PS1 que había. Un bash o su anidado lee su .bashrc, como en Ubuntu. En un aula puede estar bloqueada por el profesor.'),
    ],
  },
  {
    id: 'linux-ficheros',
    title: 'Sistema de ficheros y permisos',
    summary: 'Árbol de directorios, ficheros generados por la simulación, /var/www/html y permisos.',
    blocks: [
      table(['Ruta', 'Contenido'], [
        ['/home/alumno · /home/admin · /root', 'Directorios personales (.bashrc, .profile, .bash_history)'],
        ['/etc/passwd · /etc/group · /etc/shadow', 'Cuentas del equipo, generadas a partir de las cuentas SSH (shadow solo para root)'],
        ['/etc/hostname · /etc/resolv.conf · /etc/netplan/50-cloud-init.yaml', 'Generados: siguen la configuración IP del equipo (resolv.conf incluye «search» con los dominios de netplan y de DHCP)'],
        ['/etc/hosts', 'Archivo normal que edita root (sudo nano /etc/hosts): ping, ssh, curl, el navegador y la Terminal Windows (que comparte el sistema de archivos Linux) lo consultan antes que el DNS; nslookup, host y dig preguntan solo al servidor DNS. hostname -f da el primer nombre de la línea del equipo. Se guarda con la topología.'],
        ['/etc/kea · /etc/bind · /etc/postfix · /etc/dovecot · /etc/ssh/sshd_config', 'Generados en servidores: siguen la pestaña Servicios'],
        ['/var/lib/kea/kea-leases4.csv', 'Concesiones DHCP actuales'],
        ['/var/www/html', 'Las páginas del servidor web (lectura y escritura con sudo)'],
        ['/usr/bin · /usr/sbin', 'Programas'],
        ['/tmp', 'Temporal (todos pueden escribir; bit sticky)'],
        ['/dev/null · /dev/zero · /dev/random · /dev/tty', 'Dispositivos'],
        ['/proc/version · /proc/cpuinfo · /proc/meminfo', 'Información del sistema'],
      ]),
      p('Los ficheros generados son de solo lectura («Read-only file system»): se cambian desde la interfaz (Configuración IP, Servicios) y la terminal los ve al momento.'),
      h('Permisos'),
      code('$ ls -l /etc/shadow\n-rw-r----- 1 root shadow 120 Oct 11 10:00 /etc/shadow\n$ chmod 750 script.sh      # rwxr-x---\n$ chmod u+x,go-w script.sh\n$ umask 022\n$ sudo chown root:root f'),
      list(
        'Se comprueban lectura, escritura y ejecución para dueño, grupo y otros, el bit sticky de /tmp y la ejecución en directorios.',
        'root puede leer y escribir todo salvo los ficheros generados.',
        'Límites: 256 KiB por fichero y 4 MiB por equipo («File too large», «No space left on device»).',
      ),
    ],
  },
  {
    id: 'linux-programas',
    title: 'Programas de la Terminal Linux',
    summary: 'Todas las utilidades disponibles con sus opciones.',
    blocks: [
      p('Cada programa acepta las opciones habituales de GNU y produce sus mensajes de error. man PROGRAMA muestra esta misma información en la terminal.'),
      ...utilityBlocks(['ficheros', 'texto', 'sistema', 'shell', 'editores']),
    ],
  },
  {
    id: 'linux-red',
    title: 'Red y servicios desde Linux',
    summary: 'ip, ping, dig, curl, wget, ssh, dhclient, ss, systemctl y journalctl.',
    blocks: [
      ...utilityBlocks(['red', 'servicios']),
      h('Ejemplos'),
      code('$ ip r\ndefault via 192.168.10.1 dev eth0 proto dhcp metric 100\n$ dig +short www.aula.lab\nsrv.aula.lab.\n192.168.10.2\n$ curl -I http://www.aula.lab\nHTTP/1.1 200 OK\nServer: Apache/2.4.62 (Ubuntu)\n$ ping -c 1 noexiste.aula.lab\nping: noexiste.aula.lab: Name or service not known\n$ systemctl stop apache2\nFailed to stop apache2.service: Interactive authentication required.'),
    ],
  },
];
