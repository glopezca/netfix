/** Documentación: el servicio de correo de Server (postfix y dovecot), en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, figure, h, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const MAIL_DOCS: readonly DocPage[] = [
  {
    id: 'srv-mail',
    title: 'Correo',
    summary: 'SMTP, POP3 e IMAP paso a paso: dominio, cuentas, entrega local y reenvío a otros dominios por MX.',
    markdownBase: MD,
    blocks: [
      p('Un servidor de correo hace dos trabajos distintos. **Recibe** los mensajes por **SMTP** (puerto 25, postfix) y los guarda en el buzón de cada usuario. **Entrega** el buzón al cliente de correo por **POP3** (110) o **IMAP** (143), los dos con dovecot. Cada protocolo se activa por separado en **Servicios → Correo**.'),
      figure({
        type: 'sequence',
        actors: ['PC0 (ana)', 'SRV aula.lab', 'DNS', 'SRV dos.lab'],
        messages: [
          { from: 0, to: 1, text: 'SMTP (25)', note: 'a luis (buzón local) y a bea@dos.lab' },
          { from: 1, to: 2, text: 'dos.lab MX?', note: 'otro dominio: busca su servidor de correo' },
          { from: 2, to: 1, text: 'mail.dos.lab' },
          { from: 1, to: 3, text: 'SMTP (25)', note: 'reenvía (relay)' },
        ],
      }, 'El correo a una dirección del propio dominio se guarda en el buzón; el de otro dominio se reenvía al servidor que indica su registro MX.'),
      h('Paso a paso'),
      steps(
        ['Activa los protocolos', '**SMTP (puerto 25 · postfix)** para recibir y enviar; **POP3** y/o **IMAP** para que los clientes lean el buzón.'],
        ['Escribe el dominio', '**Dominio de correo** (aula.lab): las direcciones serán usuario@aula.lab, y solo las de ese dominio son locales.'],
        ['Crea las cuentas', 'En **Usuarios de correo**, usuario y contraseña, y **Añadir**. **Buzones** muestra cuántos mensajes tiene cada uno.'],
        ['Publica el MX', 'En **Servicios → DNS**, un registro MX en la zona (`@` MX 10 `srv`) para que otros servidores sepan adónde enviar el correo de aula.lab.'],
        ['Configura los PC', 'En cada PC, **Correo → Configurar cuenta de correo** con el servidor de entrada y el de salida (dirección IP o nombre).'],
      ),
      table(['Protocolo', 'Puerto', 'Qué hace con el mensaje'], [
        ['SMTP', '25/tcp', 'Envía y recibe entre servidores; el PC lo usa para enviar.'],
        ['POP3', '110/tcp', 'Descarga el buzón y borra los mensajes del servidor.'],
        ['IMAP', '143/tcp', 'Lee los mensajes dejándolos en el servidor (varios dispositivos ven lo mismo).'],
      ]),
      check('Compruébalo en Registros', 'Cada envío deja una línea en **Servicios → Registros → postfix** (o `journalctl -u postfix`): **relay=local** si se guardó en un buzón del servidor, **relay=** con el dominio de destino si se reenvió, y **bounced** si no se pudo entregar.'),
      term('messages', 'Oct 24 06:25:38 srv master[1021]: postfix/smtpd: connect from 192.168.10.100; from=<ana@aula.lab> nrcpt=1\nOct 24 06:25:38 srv master[1021]: postfix/local: to=<luis@aula.lab>, relay=local, status=sent (delivered to mailbox)\nOct 24 06:25:38 srv master[1021]: postfix/smtp: to=<bea@otro.lab>, status=bounced (Host or domain name not found. Name service error for name=otro.lab type=MX)'),
      tip('Correo web', 'Con **Roundcube** (Servicios → HTTP → Aplicaciones web) los usuarios leen y escriben desde el navegador, sin configurar el cliente de correo del PC. Usa el IMAP y el SMTP de este mismo servidor.'),
      warn('Errores habituales', '**bounced … type=MX**: el dominio de destino no tiene registro MX (o el servidor no resuelve nombres ajenos). El PC no envía: SMTP está apagado o el servidor de salida está mal escrito. «Recibir» no trae nada: el protocolo de entrada elegido en el PC (POP3 o IMAP) está apagado en el servidor, o el usuario o la contraseña no coinciden.'),
      h('Editar main.cf y dovecot.conf a mano'),
      p('root puede editar `/etc/postfix/main.cf` y `/etc/dovecot/dovecot.conf` desde la Terminal GNU/Linux (`sudo nano /etc/postfix/main.cf`). Guardar no aplica nada: postfix y dovecot leen su fichero al arrancar, reiniciar o recargar (`sudo systemctl reload postfix`, `sudo postfix reload`, `sudo systemctl reload dovecot`). De main.cf se toma el dominio (**mydomain**, o myhostname sin su primera parte); de dovecot.conf, **protocols** enciende POP3 e IMAP. Si el fichero es correcto, el panel Correo y la gestión web muestran lo que escribiste; si no, la unidad queda **failed** y el error va al registro. Un reload con errores deja el servicio como estaba. Compruébalo antes con `sudo postfix check`, `postconf -n` y `doveconf -n`:'),
      term('shell', 'admin@srv:~$ sudo postfix check\npostfix: fatal: file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab\nadmin@srv:~$ doveconf -n > /dev/null\ndoveconf: Fatal: Error in configuration file /etc/dovecot/dovecot.conf line 6: Unknown setting: mail_location\nadmin@srv:~$ sudo systemctl restart postfix\nJob for postfix.service failed because the control process exited with error code.\nSee "systemctl status postfix.service" and "journalctl -xeu postfix.service" for details.\nadmin@srv:~$ journalctl -u postfix -n 4'),
      term('messages', "Nov 06 10:00:00 srv postfix/postfix-script[1021]: fatal: file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab\nNov 06 10:00:00 srv systemd[1]: postfix.service: Main process exited, code=exited, status=1/FAILURE\nNov 06 10:00:00 srv systemd[1]: postfix.service: Failed with result 'exit-code'.\nNov 06 10:00:00 srv systemd[1]: Failed to start postfix.service - Postfix Mail Transport Agent."),
      p('Como en Webmin, cambiar el dominio desde el panel o la gestión web vuelve a escribir main.cf desde su configuración: lo que editaste y no aplicaste se pierde. Parar o arrancar el servicio no reescribe nada. El laboratorio guarda los ficheros editados y, al abrirlo, postfix y dovecot arrancan con ellos.'),
      exercise('Un correo que vuelve', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», envía desde PC0 un mensaje a luis@aula.lab y otro a bea@otro.lab. ¿Qué dice el registro de postfix de cada uno?', 'Para luis: `relay=local, status=sent (delivered to mailbox)`, y PC1 lo recibe con Recibir. Para bea: `status=bounced (Host or domain name not found. Name service error for name=otro.lab type=MX)`: no existe el dominio otro.lab, así que no hay servidor al que reenviarlo.'),
    ],
  },
];
