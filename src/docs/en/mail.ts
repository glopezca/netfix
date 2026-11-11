/** Documentation: the Server's mail service (postfix and dovecot), in guided style. */
import type { DocPage } from '../types.ts';
import { check, exercise, figure, h, p, shot, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const MAIL_DOCS: readonly DocPage[] = [
  {
    id: 'srv-mail',
    title: 'Email',
    summary: 'SMTP, POP3 and IMAP step by step: domain, accounts, local delivery and relaying to other domains by MX.',
    markdownBase: MD,
    blocks: [
      p('A mail server does two different jobs. It **receives** messages over **SMTP** (port 25, postfix) and stores them in each user’s mailbox. It **hands** the mailbox to the mail client over **POP3** (110) or **IMAP** (143), both with dovecot. Each protocol is switched on separately in **Services → Email**.'),
      figure({
        type: 'sequence',
        actors: ['PC0 (ana)', 'SRV aula.lab', 'DNS', 'SRV dos.lab'],
        messages: [
          { from: 0, to: 1, text: 'SMTP (25)', note: 'to luis (local mailbox) and bea@dos.lab' },
          { from: 1, to: 2, text: 'dos.lab MX?', note: 'another domain: looks up its mail server' },
          { from: 2, to: 1, text: 'mail.dos.lab' },
          { from: 1, to: 3, text: 'SMTP (25)', note: 'relays it' },
        ],
      }, 'Mail to an address of the server’s own domain goes into the mailbox; mail to another domain is relayed to the server its MX record names.'),
      h('Step by step'),
      steps(
        ['Switch the protocols on', '**SMTP (port 25 · postfix)** to receive and send; **POP3** and/or **IMAP** so the clients can read the mailbox.'],
        ['Type the domain', '**Mail domain** (aula.lab): addresses will be user@aula.lab, and only those of that domain are local.'],
        ['Create the accounts', 'In **Email users**, user and password, and **Add**. **Mailboxes** shows how many messages each one has.'],
        ['Publish the MX', 'In **Services → DNS**, an MX record in the zone (`@` MX 10 `srv`) so other servers know where to send aula.lab’s mail.'],
        ['Set up the PCs', 'On each PC, **Email → Set up an email account** with the incoming and outgoing servers (IP address or name).'],
      ),
      table(['Protocol', 'Port', 'What it does with the message'], [
        ['SMTP', '25/tcp', 'Sends and receives between servers; the PC uses it to send.'],
        ['POP3', '110/tcp', 'Downloads the mailbox and deletes the messages from the server.'],
        ['IMAP', '143/tcp', 'Reads the messages leaving them on the server (several devices see the same).'],
      ]),
      check('Check it in Logs', 'Each delivery leaves a line in **Services → Logs → postfix** (or `journalctl -u postfix`): **relay=local** if it went into a mailbox on the server, **relay=** with the destination domain if it was relayed, and **bounced** if it could not be delivered.'),
      term('messages', 'Oct 24 06:25:38 srv master[1021]: postfix/smtpd: connect from 192.168.10.100; from=<ana@aula.lab> nrcpt=1\nOct 24 06:25:38 srv master[1021]: postfix/local: to=<luis@aula.lab>, relay=local, status=sent (delivered to mailbox)\nOct 24 06:25:38 srv master[1021]: postfix/smtp: to=<bea@otro.lab>, status=bounced (Host or domain name not found. Name service error for name=otro.lab type=MX)'),
      tip('Webmail', 'With **Roundcube** (Services → HTTP → Web applications) users read and write from the browser, without setting up the PC’s mail client. It uses this same server’s IMAP and SMTP.'),
      warn('Common mistakes', '**bounced … type=MX**: the destination domain has no MX record (or the server does not resolve outside names). The PC does not send: SMTP is off or the outgoing server is mistyped. “Receive” brings nothing: the incoming protocol chosen on the PC (POP3 or IMAP) is off on the server, or the user or password do not match.'),
      shot('mail-panel', 'SRV’s local panel, Services → Email: SMTP (postfix), POP3 and IMAP (dovecot), the domain and the accounts.'),
      shot('mail-webgui', 'The Email page of the web management (`?page=mail`), opened from PC0: the same switches, the domain and the accounts.'),
      h('Editing main.cf and dovecot.conf by hand'),
      p('root can edit `/etc/postfix/main.cf` and `/etc/dovecot/dovecot.conf` from the GNU/Linux Terminal (`sudo nano /etc/postfix/main.cf`). Saving applies nothing: postfix and dovecot read their file when they start, restart or reload (`sudo systemctl reload postfix`, `sudo postfix reload`, `sudo systemctl reload dovecot`). From main.cf the domain is taken (**mydomain**, or myhostname without its first label); in dovecot.conf, **protocols** turns POP3 and IMAP on. If the file is right, the Email panel and the web management show what you wrote; if not, the unit is left **failed** and the error goes to the log. A reload with errors leaves the service as it was. Check first with `sudo postfix check`, `postconf -n` and `doveconf -n`:'),
      term('shell', 'admin@srv:~$ sudo postfix check\npostfix: fatal: file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab\nadmin@srv:~$ doveconf -n > /dev/null\ndoveconf: Fatal: Error in configuration file /etc/dovecot/dovecot.conf line 6: Unknown setting: mail_location\nadmin@srv:~$ sudo systemctl restart postfix\nJob for postfix.service failed because the control process exited with error code.\nSee "systemctl status postfix.service" and "journalctl -xeu postfix.service" for details.\nadmin@srv:~$ journalctl -u postfix -n 4'),
      term('messages', "Nov 06 10:00:00 srv postfix/postfix-script[1021]: fatal: file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab\nNov 06 10:00:00 srv systemd[1]: postfix.service: Main process exited, code=exited, status=1/FAILURE\nNov 06 10:00:00 srv systemd[1]: postfix.service: Failed with result 'exit-code'.\nNov 06 10:00:00 srv systemd[1]: Failed to start postfix.service - Postfix Mail Transport Agent."),
      p('As in Webmin, changing the domain from the panel or the web management writes main.cf again from its settings: what you edited and did not apply is lost. Stopping or starting the service rewrites nothing. The lab saves the edited files and, when opened, postfix and dovecot start with them.'),
      exercise('A message that comes back', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, send from PC0 a message to luis@aula.lab and another to bea@otro.lab. What does postfix’s log say about each one?', 'For luis: `relay=local, status=sent (delivered to mailbox)`, and PC1 gets it with Receive. For bea: `status=bounced (Host or domain name not found. Name service error for name=otro.lab type=MX)`: the domain otro.lab does not exist, so there is no server to relay it to.'),
    ],
  },
];
