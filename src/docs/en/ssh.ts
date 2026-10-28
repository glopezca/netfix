/** Documentation: SSH the OpenSSH way (key pairs, sshd_config, SFTP and scp), in guided style. */
import type { DocPage } from '../types.ts';
import { check, code, exercise, figure, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const SSH_DOCS: readonly DocPage[] = [
  {
    id: 'srv-ssh-claves',
    title: 'SSH with key pairs',
    summary: 'Logging in without a password: ssh-keygen, ssh-copy-id, authorized_keys, known_hosts and passphrases, as in OpenSSH.',
    markdownBase: MD,
    blocks: [
      p('A **key pair** is two files that belong together: the **private** key (~/.ssh/id_ed25519), which never leaves your device, and the **public** one (id_ed25519.pub), which is copied to the server. When you connect, the server checks that you hold the private key without it travelling over the network. It is safer than a password and there is nothing to type.'),
      figure({
        type: 'topology',
        nodes: [
          { id: 'pc1', kind: 'pc', label: 'PC1', x: 10, y: 10, note: '~/.ssh/id_ed25519 (private)' },
          { id: 'srv', kind: 'server', label: 'SRV', x: 70, y: 10, note: '~admin/.ssh/authorized_keys' },
        ],
        links: [{ a: 'pc1', b: 'srv', label: 'ssh-copy-id: copies the .pub' }],
      }, 'The public key ends up in the remote user’s authorized_keys; the private one stays on the PC.'),
      h('Step by step'),
      steps(
        ['Create the pair', '`ssh-keygen` on the PC. Enter accepts ~/.ssh/id_ed25519; the passphrase can stay empty (or set one to protect the key if the file is stolen).'],
        ['Copy the public key', '`ssh-copy-id admin@srv.aula.lab`: it asks for the password **only once** and adds the key to ~/.ssh/authorized_keys on the server.'],
        ['Log in', '`ssh admin@srv.aula.lab` no longer asks for a password. The server’s log says **Accepted publickey**.'],
      ),
      term('shell', 'alumno@pc1:~$ ssh-keygen\nGenerating public/private ed25519 key pair.\nEnter file in which to save the key (/home/alumno/.ssh/id_ed25519):\nEnter passphrase for "/home/alumno/.ssh/id_ed25519" (empty for no passphrase):\nYour identification has been saved in /home/alumno/.ssh/id_ed25519\nalumno@pc1:~$ ssh-copy-id admin@srv.aula.lab\nadmin@srv.aula.lab\'s password:\nNumber of key(s) added: 1\nalumno@pc1:~$ ssh admin@srv.aula.lab\nWelcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)\nadmin@srv:~$ cat ~/.ssh/authorized_keys\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… alumno@pc1'),
      h('The server’s key: known_hosts'),
      p('The server has its own key pair too. The first time, ssh shows its fingerprint and asks; answering **yes** saves it in ~/.ssh/known_hosts. The fingerprint is checked on the server with `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub`. If the key changes (it is regenerated, or another device has the same IP address), ssh shows “REMOTE HOST IDENTIFICATION HAS CHANGED!” and does not connect until the old line is removed with `ssh-keygen -R`.'),
      table(['Command', 'What it does'], [
        ['ssh-keygen -t rsa -b 4096 -C "comment"', 'Another key type or size (ed25519 by default; 256-bit ecdsa; rsa from 1024 to 16384).'],
        ['ssh-keygen -f key -N ""', 'No questions: file and passphrase on the command line (-q silences the output).'],
        ['ssh-keygen -p -f ~/.ssh/id_ed25519', 'Sets, changes or removes the passphrase.'],
        ['ssh-keygen -l -f file / -y -f private', 'SHA256 fingerprint / public key derived from the private one.'],
        ['ssh-keygen -F host / -R host', 'Finds or removes a host from known_hosts (keeps a copy in known_hosts.old).'],
        ['ssh -i key user@host', 'Uses that private key as well as the ones in ~/.ssh.'],
        ['ssh user@host command', 'Runs the remote command and returns its exit status.'],
      ]),
      warn('Permissions that are checked', 'On the client, the private key cannot be readable by others (chmod 600): with 644 you get “WARNING: UNPROTECTED PRIVATE KEY FILE!” and it is ignored. On the server (StrictModes yes), the home, ~/.ssh and authorized_keys cannot be writable by group or others: the log says “Authentication refused: bad ownership or modes”.'),
      table(['-o option', 'Effect'], [
        ['StrictHostKeyChecking=yes|no|accept-new', 'Do not connect to unknown hosts / accept without asking / accept only new ones.'],
        ['UserKnownHostsFile=/dev/null', 'Neither read nor save known_hosts.'],
        ['PasswordAuthentication=no · PubkeyAuthentication=no', 'Disables a method on the client.'],
        ['BatchMode=yes', 'Never asks (scripts): fails if a password or passphrase would be needed.'],
      ]),
      p('With StrictHostKeyChecking=no and a changed server key, ssh warns and connects, but disables passwords (“Password authentication is disabled to avoid man-in-the-middle attacks.”): only a key pair gets in.'),
      h('Options in authorized_keys'),
      code('from="192.168.10.*,!192.168.10.66" ssh-ed25519 AAAAC3Nza… alumno@pc0\nrestrict ssh-ed25519 AAAAC3Nza… copias@srv2'),
      list(
        'from="patterns": the key is only valid from those IP addresses (* and ? as wildcards, ! negates). If it does not match: “not from a permitted host” in journalctl.',
        'restrict, no-pty, no-port-forwarding, no-agent-forwarding, no-X11-forwarding and no-user-rc are accepted (Netfix has none of those features).',
        'command=, environment=, principals=, cert-authority and the rest are not implemented: the line is rejected (“bad key options”) rather than granting access without the restriction.',
      ),
      note('Netfix uses the real formats (ssh-ed25519 AAAA…, “-----BEGIN OPENSSH PRIVATE KEY-----”, SHA256:…). Inside are 256-bit Schnorr keys: the signature really proves possession of the private key (the public one cannot sign) and the server signs with its host key, but they are not real Ed25519/RSA keys and are no use outside the simulator.'),
      exercise('Log in without a password', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, get alumno on PC1 to log in as admin on SRV without typing the password, and run `hostname` remotely.', '`ssh-keygen` (Enter to everything), `ssh-copy-id admin@srv.aula.lab` (yes and the password netfix once). Then `ssh admin@srv.aula.lab hostname` answers srv without asking for anything. On SRV, ~admin/.ssh/authorized_keys ends in “alumno@pc1”.'),
    ],
  },
  {
    id: 'srv-sshd-config',
    title: 'sshd configuration',
    summary: '/etc/ssh/sshd_config and sshd_config.d: authentication methods, allowed users and reloading the service.',
    markdownBase: MD,
    blocks: [
      p('The Ubuntu server reads **/etc/ssh/sshd_config** when ssh starts and on `systemctl reload ssh`. As in OpenSSH, **the first value of each option is the one that counts**, and the files in /etc/ssh/sshd_config.d/*.conf are included at the top: they win over whatever comes later in the main file. That is why changes are usually written in a file of your own inside sshd_config.d.'),
      table(['Option', 'Default', 'Effect'], [
        ['PasswordAuthentication', 'yes', 'Access with user and password.'],
        ['PubkeyAuthentication', 'yes', 'Access with a key pair (~/.ssh/authorized_keys).'],
        ['AuthorizedKeysFile', '.ssh/authorized_keys .ssh/authorized_keys2', 'Key files (relative to the home; accepts %h and %u).'],
        ['StrictModes', 'yes', 'Refuses keys if the permissions of the home or ~/.ssh are unsafe.'],
        ['PermitEmptyPasswords', 'no', 'Empty passwords.'],
        ['PermitRootLogin', 'prohibit-password', 'root: yes, no or keys only (prohibit-password).'],
        ['AllowUsers / DenyUsers', '—', 'Users who can (or cannot) log in: user or user@IP, with * and ?. Several lines add up.'],
        ['AllowGroups / DenyGroups', '—', 'The same by group (/etc/group).'],
        ['MaxAuthTries', '6', 'Failed attempts per connection; then: “Too many authentication failures”.'],
      ]),
      h('Step by step: keys only'),
      steps(
        ['Install your key first', 'If you remove the password without a key installed, you lock yourself out (see “SSH with key pairs”).'],
        ['Write the option', 'As root, a file in sshd_config.d with `PasswordAuthentication no`.'],
        ['Reload', '`systemctl reload ssh`. If there is an error, the reload fails and ssh keeps the previous configuration.'],
        ['Check', 'From a device without a key: “Permission denied (publickey).”. With a key, it gets in.'],
      ),
      term('shell', "root@srv:~# echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-claves.conf\nroot@srv:~# systemctl reload ssh\nalumno@pc0:~$ ssh admin@srv.aula.lab\nadmin@srv.aula.lab: Permission denied (publickey)."),
      tip('From the panel', 'In **Services → SSH → Authentication** (and in web management), the **User and password** and **Key pair** boxes write PasswordAuthentication and PubkeyAuthentication to sshd_config and reload ssh. If a file in sshd_config.d sets the same option earlier, the panel warns that that one counts.'),
      warn('What is not there', 'Match, ForceCommand, ChrootDirectory, AuthenticationMethods and other access-control options are not implemented: sshd rejects them (“Unsupported option”) so that a practical never believes something is protected when it is not. An unknown or misspelt option also makes the reload fail (“Bad configuration option” in journalctl -u ssh).'),
      note('The server’s key is in /etc/ssh/ssh_host_ed25519_key (and the ecdsa and rsa ones). If it is deleted, ssh does not start: “sshd: no hostkeys available -- exiting.”; ssh-keygen -A creates the missing ones.'),
      exercise('Keys only for everyone', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, install PC1’s key for admin and turn off the password. Check that PC1 gets in and PC0 does not.', 'On PC1, `ssh-keygen` and `ssh-copy-id admin@srv.aula.lab`. On SRV, as root, `echo \'PasswordAuthentication no\' > /etc/ssh/sshd_config.d/10-solo-claves.conf` and `systemctl reload ssh` (or untick **User and password** in the panel). PC1: `ssh admin@srv.aula.lab hostname` gives srv. PC0: “admin@srv.aula.lab: Permission denied (publickey).”.'),
    ],
  },
  {
    id: 'srv-sftp',
    title: 'SFTP and scp',
    summary: 'Copying files over SSH: interactive and batch sftp, scp, and the PC’s SSH Client and Files (SFTP) apps.',
    markdownBase: MD,
    blocks: [
      p('**sftp** and **scp** copy files over the same encrypted SSH connection (password or key pair), through the “Subsystem sftp …” subsystem in sshd_config. Every operation runs with the user’s permissions on the server: without write permission, “Permission denied”.'),
      steps(
        ['Open the session', '`sftp user@server`: the prompt changes to `sftp>`.'],
        ['Move around', '`ls`, `cd` and `pwd` act on the server; `lls`, `lcd` and `lpwd`, on your device.'],
        ['Copy', '`put file` uploads, `get file` downloads.'],
        ['Leave', '`bye` (or `exit`).'],
      ),
      term('shell', 'alumno@pc1:~$ sftp admin@srv.aula.lab\nConnected to srv.aula.lab.\nsftp> put tarea.txt\nUploading tarea.txt to /home/admin/tarea.txt\ntarea.txt                                      100%     5   0.0KB/s   00:00\nsftp> ls\ntarea.txt\nsftp> bye\nalumno@pc1:~$ scp tarea.txt admin@srv.aula.lab:copia.txt\ntarea.txt                                      100%     5   0.0KB/s   00:00'),
      table(['sftp command', 'Effect'], [
        ['ls [-la] · cd · pwd', 'On the server.'],
        ['lls · lcd · lpwd · lmkdir', 'On the local device.'],
        ['get REMOTE [LOCAL] · put LOCAL [REMOTE]', 'Download / upload.'],
        ['mkdir · rmdir · rm · rename · chmod 640 FILE', 'Managing remote files.'],
        ['sftp -b batchfile user@host', 'Runs the commands in a file (implies BatchMode: a key pair is required).'],
      ]),
      p('**scp** copies in a single command, like cp: `scp SOURCE TARGET`, where a remote side is written `user@server:path` (relative to the home if it does not start with /).'),
      code('alumno@pc1:~$ scp informe.txt admin@srv.aula.lab:entregas/\nalumno@pc1:~$ scp admin@srv.aula.lab:/etc/hostname .'),
      h('PC apps'),
      list(
        'SSH client (like PuTTY): saved sessions, one terminal per session, key-pair generation and a list of known hosts with their fingerprints.',
        'Files (SFTP) (like FileZilla): quick connect, local and remote panes, upload, download, new folder, rename and delete; asks about the server’s fingerprint the first time.',
      ),
      warn('If it fails', 'If you remove the Subsystem line from sshd_config and reload ssh, sftp and scp fail with “subsystem request failed on channel 0”, but ssh keeps working.'),
      check('Check it', 'On the server, `ls -l ~` (over SSH or in its terminal) shows the uploaded file owned by the session’s user.'),
      exercise('Hand in the assignment', 'In the «Server: DHCP, DNS, web, mail and SSH» lab, create a file tarea.txt on PC1 and upload it to admin’s home on SRV, first with sftp and then with scp as copia.txt.', '`echo hola > tarea.txt`; `sftp admin@srv.aula.lab`, `put tarea.txt` (“Uploading tarea.txt to /home/admin/tarea.txt”), `bye`. Then `scp tarea.txt admin@srv.aula.lab:copia.txt`. On SRV, `ls ~admin` shows copia.txt and tarea.txt.'),
    ],
  },
];
