/** Documentación: SSH al estilo OpenSSH (pares de claves, sshd_config, SFTP y scp), en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const SSH_DOCS: readonly DocPage[] = [
  {
    id: 'srv-ssh-claves',
    title: 'SSH con pares de claves',
    summary: 'Entrar sin contraseña: ssh-keygen, ssh-copy-id, authorized_keys, known_hosts y frases de paso, como en OpenSSH.',
    markdownBase: MD,
    blocks: [
      p('Un **par de claves** son dos ficheros que van juntos: la clave **privada** (~/.ssh/id_ed25519), que nunca sale de tu equipo, y la **pública** (id_ed25519.pub), que se copia al servidor. Al conectar, el servidor comprueba que tienes la privada sin que viaje por la red. Es más seguro que una contraseña y no hay que escribirla.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'pc1', kind: 'pc', label: 'PC1', x: 10, y: 10, note: '~/.ssh/id_ed25519 (privada)' },
          { id: 'srv', kind: 'server', label: 'SRV', x: 70, y: 10, note: '~admin/.ssh/authorized_keys' },
        ],
        links: [{ a: 'pc1', b: 'srv', label: 'ssh-copy-id: copia la .pub' }],
      }, 'La clave pública acaba en authorized_keys del usuario remoto; la privada se queda en el PC.'),
      h('Paso a paso'),
      steps(
        ['Crea el par', '`ssh-keygen` en el PC. Intro acepta ~/.ssh/id_ed25519; la frase de paso puede quedar vacía (o ponla para proteger la clave si te roban el fichero).'],
        ['Copia la pública', '`ssh-copy-id admin@srv.aula.lab`: pide la contraseña **una sola vez** y añade la clave a ~/.ssh/authorized_keys del servidor.'],
        ['Entra', '`ssh admin@srv.aula.lab` ya no pide contraseña. El registro del servidor dice **Accepted publickey**.'],
      ),
      term('shell', 'alumno@pc1:~$ ssh-keygen\nGenerating public/private ed25519 key pair.\nEnter file in which to save the key (/home/alumno/.ssh/id_ed25519):\nEnter passphrase for "/home/alumno/.ssh/id_ed25519" (empty for no passphrase):\nYour identification has been saved in /home/alumno/.ssh/id_ed25519\nalumno@pc1:~$ ssh-copy-id admin@srv.aula.lab\nadmin@srv.aula.lab\'s password:\nNumber of key(s) added: 1\nalumno@pc1:~$ ssh admin@srv.aula.lab\nWelcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)\nadmin@srv:~$ cat ~/.ssh/authorized_keys\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… alumno@pc1'),
      h('La clave del servidor: known_hosts'),
      p('El servidor también tiene su par de claves. La primera vez, ssh enseña su huella y pregunta; al responder **yes** la guarda en ~/.ssh/known_hosts. La huella se comprueba en el servidor con `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub`. Si la clave cambia (se regenera o es otro equipo con la misma dirección IP), ssh muestra «REMOTE HOST IDENTIFICATION HAS CHANGED!» y no conecta hasta borrar la línea antigua con `ssh-keygen -R`.'),
      table(['Orden', 'Qué hace'], [
        ['ssh-keygen -t rsa -b 4096 -C "comentario"', 'Otro tipo o tamaño de clave (ed25519 por defecto; ecdsa de 256 bits; rsa de 1024 a 16384).'],
        ['ssh-keygen -f clave -N ""', 'Sin preguntas: fichero y frase de paso en la orden (-q calla la salida).'],
        ['ssh-keygen -p -f ~/.ssh/id_ed25519', 'Pone, cambia o quita la frase de paso.'],
        ['ssh-keygen -l -f fichero / -y -f privada', 'Huella SHA256 / clave pública derivada de la privada.'],
        ['ssh-keygen -F host / -R host', 'Busca o borra un equipo de known_hosts (deja copia en known_hosts.old).'],
        ['ssh -i clave usuario@host', 'Usa esa clave privada además de las de ~/.ssh.'],
        ['ssh usuario@host orden', 'Ejecuta la orden remota y devuelve su estado de salida.'],
      ]),
      warn('Permisos que se comprueban', 'En el cliente, la clave privada no puede ser legible por otros (chmod 600): con 644 aparece «WARNING: UNPROTECTED PRIVATE KEY FILE!» y se ignora. En el servidor (StrictModes yes), el home, ~/.ssh y authorized_keys no pueden tener escritura para grupo u otros: el registro dice «Authentication refused: bad ownership or modes».'),
      table(['Opción -o', 'Efecto'], [
        ['StrictHostKeyChecking=yes|no|accept-new', 'No conectar a equipos desconocidos / aceptar sin preguntar / aceptar solo los nuevos.'],
        ['UserKnownHostsFile=/dev/null', 'No leer ni guardar known_hosts.'],
        ['PasswordAuthentication=no · PubkeyAuthentication=no', 'Desactiva un método en el cliente.'],
        ['BatchMode=yes', 'Nunca pregunta (scripts): falla si haría falta contraseña o frase de paso.'],
      ]),
      p('Con StrictHostKeyChecking=no y una clave de servidor cambiada, ssh avisa y conecta, pero desactiva la contraseña («Password authentication is disabled to avoid man-in-the-middle attacks.»): solo entra con par de claves.'),
      h('Opciones en authorized_keys'),
      code('from="192.168.10.*,!192.168.10.66" ssh-ed25519 AAAAC3Nza… alumno@pc0\nrestrict ssh-ed25519 AAAAC3Nza… copias@srv2'),
      list(
        'from="patrones": la clave solo vale desde esas direcciones IP (* y ? como comodines, ! niega). Si no coincide: «not from a permitted host» en journalctl.',
        'restrict, no-pty, no-port-forwarding, no-agent-forwarding, no-X11-forwarding y no-user-rc se aceptan (Netfix no tiene esas funciones).',
        'command=, environment=, principals=, cert-authority y el resto no están implementados: la línea se rechaza («bad key options») en vez de dar acceso sin la restricción.',
      ),
      note('Netfix usa los formatos reales (ssh-ed25519 AAAA…, «-----BEGIN OPENSSH PRIVATE KEY-----», SHA256:…). Dentro van claves Schnorr de 256 bits: la firma prueba de verdad la posesión de la clave privada (la pública no sirve para firmar) y el servidor firma con su clave de host, pero no son claves Ed25519/RSA reales ni sirven fuera del simulador.'),
      exercise('Entra sin contraseña', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», consigue que alumno entre desde PC1 como admin en SRV sin escribir la contraseña, y ejecuta `hostname` en remoto.', '`ssh-keygen` (Intro a todo), `ssh-copy-id admin@srv.aula.lab` (yes y la contraseña netfix una vez). Después `ssh admin@srv.aula.lab hostname` responde srv sin pedir nada. En SRV, ~admin/.ssh/authorized_keys acaba en «alumno@pc1».'),
    ],
  },
  {
    id: 'srv-sshd-config',
    title: 'Configuración de sshd',
    summary: '/etc/ssh/sshd_config y sshd_config.d: métodos de autenticación, usuarios permitidos y recarga del servicio.',
    markdownBase: MD,
    blocks: [
      p('El servidor Ubuntu lee **/etc/ssh/sshd_config** al arrancar ssh y con `systemctl reload ssh`. Como en OpenSSH, **el primer valor de cada opción es el que vale**, y los ficheros de /etc/ssh/sshd_config.d/*.conf se incluyen al principio: mandan sobre lo que venga después en el fichero principal. Por eso los cambios se suelen escribir en un fichero propio dentro de sshd_config.d.'),
      table(['Opción', 'Por defecto', 'Efecto'], [
        ['PasswordAuthentication', 'yes', 'Acceso con usuario y contraseña.'],
        ['PubkeyAuthentication', 'yes', 'Acceso con par de claves (~/.ssh/authorized_keys).'],
        ['AuthorizedKeysFile', '.ssh/authorized_keys .ssh/authorized_keys2', 'Ficheros de claves (relativos al home; admite %h y %u).'],
        ['StrictModes', 'yes', 'Rechaza claves si los permisos del home o de ~/.ssh son inseguros.'],
        ['PermitEmptyPasswords', 'no', 'Contraseñas vacías.'],
        ['PermitRootLogin', 'prohibit-password', 'root: yes, no o solo con claves (prohibit-password).'],
        ['AllowUsers / DenyUsers', '—', 'Usuarios que pueden (o no) entrar: usuario o usuario@IP, con * y ?. Varias líneas se suman.'],
        ['AllowGroups / DenyGroups', '—', 'Lo mismo por grupo (/etc/group).'],
        ['MaxAuthTries', '6', 'Intentos fallidos por conexión; después: «Too many authentication failures».'],
      ]),
      h('Paso a paso: solo con claves'),
      steps(
        ['Instala antes tu clave', 'Si quitas la contraseña sin tener una clave instalada, te quedas fuera (ver «SSH con pares de claves»).'],
        ['Escribe la opción', 'Como root, un fichero en sshd_config.d con `PasswordAuthentication no`.'],
        ['Recarga', '`systemctl reload ssh`. Si hay un error, el reload falla y ssh sigue con la configuración anterior.'],
        ['Comprueba', 'Desde un equipo sin clave: «Permission denied (publickey).». Con clave, entra.'],
      ),
      term('shell', "root@srv:~# echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-claves.conf\nroot@srv:~# systemctl reload ssh\nalumno@pc0:~$ ssh admin@srv.aula.lab\nadmin@srv.aula.lab: Permission denied (publickey)."),
      tip('Desde el panel', 'En **Servicios → SSH → Autenticación** (y en la gestión web), las casillas **Usuario y contraseña** y **Par de claves** escriben PasswordAuthentication y PubkeyAuthentication en sshd_config y recargan ssh. Si un fichero de sshd_config.d define antes la misma opción, el panel avisa de que es ese el que vale.'),
      warn('Lo que no está', 'Match, ForceCommand, ChrootDirectory, AuthenticationMethods y otras opciones de control de acceso no están implementadas: sshd las rechaza («Unsupported option») para que una práctica nunca crea protegido algo que no lo está. Una opción desconocida o mal escrita también hace fallar el reload («Bad configuration option» en journalctl -u ssh).'),
      note('La clave del servidor está en /etc/ssh/ssh_host_ed25519_key (y las ecdsa y rsa). Si se borra, ssh no arranca: «sshd: no hostkeys available -- exiting.»; ssh-keygen -A crea las que falten.'),
      exercise('Solo claves para todos', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», instala la clave de PC1 en admin y desactiva la contraseña. Comprueba que PC1 entra y PC0 no.', 'En PC1, `ssh-keygen` y `ssh-copy-id admin@srv.aula.lab`. En SRV, como root, `echo \'PasswordAuthentication no\' > /etc/ssh/sshd_config.d/10-solo-claves.conf` y `systemctl reload ssh` (o desmarca **Usuario y contraseña** en el panel). PC1: `ssh admin@srv.aula.lab hostname` da srv. PC0: «admin@srv.aula.lab: Permission denied (publickey).».'),
    ],
  },
  {
    id: 'srv-sftp',
    title: 'SFTP y scp',
    summary: 'Copiar ficheros por SSH: sftp interactivo y por lotes, scp, y las apps Cliente SSH y Archivos (SFTP) del PC.',
    markdownBase: MD,
    blocks: [
      p('**sftp** y **scp** copian ficheros por la misma conexión cifrada de SSH (contraseña o par de claves), a través del subsistema «Subsystem sftp …» de sshd_config. Cada operación se hace con los permisos del usuario en el servidor: sin permiso de escritura, «Permission denied».'),
      steps(
        ['Abre la sesión', '`sftp usuario@servidor`: el indicador cambia a `sftp>`.'],
        ['Muévete', '`ls`, `cd` y `pwd` actúan en el servidor; `lls`, `lcd` y `lpwd`, en tu equipo.'],
        ['Copia', '`put fichero` sube, `get fichero` descarga.'],
        ['Sal', '`bye` (o `exit`).'],
      ),
      term('shell', 'alumno@pc1:~$ sftp admin@srv.aula.lab\nConnected to srv.aula.lab.\nsftp> put tarea.txt\nUploading tarea.txt to /home/admin/tarea.txt\ntarea.txt                                      100%     5   0.0KB/s   00:00\nsftp> ls\ntarea.txt\nsftp> bye\nalumno@pc1:~$ scp tarea.txt admin@srv.aula.lab:copia.txt\ntarea.txt                                      100%     5   0.0KB/s   00:00'),
      table(['Orden de sftp', 'Efecto'], [
        ['ls [-la] · cd · pwd', 'En el servidor.'],
        ['lls · lcd · lpwd · lmkdir', 'En el equipo local.'],
        ['get REMOTO [LOCAL] · put LOCAL [REMOTO]', 'Descargar / subir.'],
        ['mkdir · rmdir · rm · rename · chmod 640 FICHERO', 'Gestión de ficheros remotos.'],
        ['sftp -b lote usuario@host', 'Ejecuta las órdenes de un fichero (implica BatchMode: hace falta par de claves).'],
      ]),
      p('**scp** copia en una sola orden, como cp: `scp ORIGEN DESTINO`, donde un lado remoto se escribe `usuario@servidor:ruta` (relativa al home si no empieza por /).'),
      code('alumno@pc1:~$ scp informe.txt admin@srv.aula.lab:entregas/\nalumno@pc1:~$ scp admin@srv.aula.lab:/etc/hostname .'),
      h('Apps del PC'),
      list(
        'Cliente SSH (como PuTTY): sesiones guardadas, una terminal por sesión, generación de pares de claves y lista de hosts conocidos con su huella.',
        'Archivos (SFTP) (como FileZilla): conexión rápida, panel local y remoto, subir, descargar, nueva carpeta, renombrar y borrar; pregunta por la huella del servidor la primera vez.',
      ),
      warn('Si falla', 'Si quitas la línea Subsystem de sshd_config y recargas ssh, sftp y scp fallan con «subsystem request failed on channel 0», pero ssh sigue funcionando.'),
      check('Compruébalo', 'En el servidor, `ls -l ~` (por SSH o en su terminal) muestra el fichero subido con el usuario de la sesión como propietario.'),
      exercise('Entrega la tarea', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», crea en PC1 un fichero tarea.txt y súbelo al home de admin en SRV, primero con sftp y después con scp como copia.txt.', '`echo hola > tarea.txt`; `sftp admin@srv.aula.lab`, `put tarea.txt` («Uploading tarea.txt to /home/admin/tarea.txt»), `bye`. Después `scp tarea.txt admin@srv.aula.lab:copia.txt`. En SRV, `ls ~admin` muestra copia.txt y tarea.txt.'),
    ],
  },
];
