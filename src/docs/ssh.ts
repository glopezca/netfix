/** Documentación: SSH al estilo OpenSSH (known_hosts, pares de claves y sshd_config). */
import type { DocPage } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const SSH_DOCS: readonly DocPage[] = [
  {
    id: 'srv-ssh-claves',
    title: 'SSH con pares de claves',
    summary: 'known_hosts, ssh-keygen, ssh-copy-id, authorized_keys y frases de paso, como en OpenSSH.',
    blocks: [
      p('El cliente ssh de los equipos Ubuntu guarda en ~/.ssh lo mismo que OpenSSH: la clave de cada servidor en known_hosts y las claves del usuario en id_ed25519 / id_ecdsa / id_rsa (privada) con su .pub (pública). El servidor acepta la clave si su línea está en ~/.ssh/authorized_keys del usuario remoto.'),
      h('Primera conexión: la clave del servidor'),
      code("alumno@pc0:~$ ssh admin@srv.aula.lab\nThe authenticity of host 'srv.aula.lab (192.168.10.2)' can't be established.\nED25519 key fingerprint is SHA256:lcQmKtMREqLLbRRWefrD17pEjPrj25sOLsaZTYE4m38.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes\nWarning: Permanently added 'srv.aula.lab' (ED25519) to the list of known hosts.\nadmin@srv.aula.lab's password:"),
      p('La huella se comprueba en el servidor con ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub. Si la clave del servidor cambia (se regenera o es otro equipo con la misma dirección IP), ssh muestra «REMOTE HOST IDENTIFICATION HAS CHANGED!» y no conecta hasta borrar la línea antigua con ssh-keygen -R.'),
      h('Crear e instalar un par de claves'),
      code("alumno@pc0:~$ ssh-keygen                      # Intro acepta ~/.ssh/id_ed25519\nalumno@pc0:~$ ssh-copy-id admin@srv.aula.lab   # pide la contraseña una sola vez\nNumber of key(s) added: 1\nalumno@pc0:~$ ssh admin@srv.aula.lab           # ya no pide contraseña\nadmin@srv:~$ cat ~/.ssh/authorized_keys\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… alumno@pc0"),
      table(['Orden', 'Qué hace'], [
        ['ssh-keygen -t rsa -b 4096 -C "comentario"', 'Otro tipo o tamaño de clave (ed25519 por defecto; ecdsa de 256 bits; rsa de 1024 a 16384).'],
        ['ssh-keygen -f clave -N ""', 'Sin preguntas: fichero y frase de paso en la orden (-q calla la salida).'],
        ['ssh-keygen -p -f ~/.ssh/id_ed25519', 'Pone, cambia o quita la frase de paso.'],
        ['ssh-keygen -l -f fichero / -y -f privada', 'Huella SHA256 / clave pública derivada de la privada.'],
        ['ssh-keygen -F host / -R host', 'Busca o borra un equipo de known_hosts (deja copia en known_hosts.old).'],
        ['ssh -i clave usuario@host', 'Usa esa clave privada además de las de ~/.ssh.'],
        ['ssh usuario@host orden', 'Ejecuta la orden remota y devuelve su estado de salida.'],
      ]),
      h('Permisos que se comprueban'),
      list(
        'Cliente: la clave privada no puede ser legible por otros (chmod 600). Con 644 aparece «WARNING: UNPROTECTED PRIVATE KEY FILE!» y la clave se ignora.',
        'Servidor (StrictModes yes): el home, ~/.ssh y authorized_keys no pueden tener escritura para grupo u otros; si la tienen, el registro dice «Authentication refused: bad ownership or modes».',
        'Con frase de paso, ssh la pide («Enter passphrase for key …»); Intro vacío pasa a la siguiente clave o a la contraseña.',
      ),
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
    ],
  },
  {
    id: 'srv-sshd-config',
    title: 'Configuración de sshd',
    summary: '/etc/ssh/sshd_config y sshd_config.d: métodos de autenticación, usuarios permitidos y recarga del servicio.',
    blocks: [
      p('El servidor Ubuntu lee /etc/ssh/sshd_config al arrancar ssh y con systemctl reload|restart ssh. Como en OpenSSH, el primer valor de cada opción es el que vale y los ficheros de /etc/ssh/sshd_config.d/*.conf se incluyen al principio, así que mandan sobre lo que venga después en el fichero principal.'),
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
      code("root@srv:~# echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-claves.conf\nroot@srv:~# systemctl reload ssh\nalumno@pc0:~$ ssh ana@srv.aula.lab\nana@srv.aula.lab: Permission denied (publickey)."),
      list(
        'Una opción desconocida o mal escrita hace fallar el reload («Bad configuration option» en journalctl -u ssh) y el servicio sigue con la configuración anterior.',
        'Match, ForceCommand, ChrootDirectory, AuthenticationMethods y otras opciones de control de acceso no están implementadas: sshd las rechaza («Unsupported option») para que una práctica nunca crea protegido algo que no lo está.',
        'La clave del servidor está en /etc/ssh/ssh_host_ed25519_key (y las ecdsa y rsa). Si se borra, ssh no arranca: «sshd: no hostkeys available -- exiting.»; ssh-keygen -A crea las que falten.',
        'En la ventana del servidor (Servicios → SSH) y en la gestión web los interruptores de autenticación escriben PasswordAuthentication y PubkeyAuthentication en sshd_config y recargan ssh.',
      ),
    ],
  },
];
