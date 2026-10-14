/** Documentation: OpenSSH-style SSH (known_hosts, key pairs and sshd_config). */
import type { DocPage } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';

export const SSH_DOCS: readonly DocPage[] = [
  {
    id: 'srv-ssh-claves',
    title: 'SSH with key pairs',
    summary: 'known_hosts, ssh-keygen, ssh-copy-id, authorized_keys and passphrases, as in OpenSSH.',
    blocks: [
      p('The ssh client on Ubuntu devices keeps the same things in ~/.ssh as OpenSSH: each server’s key in known_hosts and the user’s keys in id_ed25519 / id_ecdsa / id_rsa (private) with their .pub (public). The server accepts the key if its line is in the remote user’s ~/.ssh/authorized_keys.'),
      h('First connection: the server’s key'),
      code("alumno@pc0:~$ ssh admin@srv.aula.lab\nThe authenticity of host 'srv.aula.lab (192.168.10.2)' can't be established.\nED25519 key fingerprint is SHA256:lcQmKtMREqLLbRRWefrD17pEjPrj25sOLsaZTYE4m38.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes\nWarning: Permanently added 'srv.aula.lab' (ED25519) to the list of known hosts.\nadmin@srv.aula.lab's password:"),
      p('The fingerprint is checked on the server with ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub. If the server’s key changes (it is regenerated, or another device has the same IP), ssh shows “REMOTE HOST IDENTIFICATION HAS CHANGED!” and will not connect until the old line is removed with ssh-keygen -R.'),
      h('Creating and installing a key pair'),
      code("alumno@pc0:~$ ssh-keygen                      # Enter accepts ~/.ssh/id_ed25519\nalumno@pc0:~$ ssh-copy-id admin@srv.aula.lab   # asks for the password only once\nNumber of key(s) added: 1\nalumno@pc0:~$ ssh admin@srv.aula.lab           # no longer asks for a password\nadmin@srv:~$ cat ~/.ssh/authorized_keys\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… alumno@pc0"),
      table(['Command', 'What it does'], [
        ['ssh-keygen -t rsa -b 4096 -C "comentario"', 'Another key type or size (ed25519 by default; 256-bit ecdsa; rsa from 1024 to 16384).'],
        ['ssh-keygen -f clave -N ""', 'No questions: file and passphrase on the command line (-q silences the output).'],
        ['ssh-keygen -p -f ~/.ssh/id_ed25519', 'Sets, changes or removes the passphrase.'],
        ['ssh-keygen -l -f file / -y -f private', 'SHA256 fingerprint / public key derived from the private one.'],
        ['ssh-keygen -F host / -R host', 'Finds or removes a host in known_hosts (leaves a copy in known_hosts.old).'],
        ['ssh -i clave usuario@host', 'Uses that private key as well as those in ~/.ssh.'],
        ['ssh usuario@host orden', 'Runs the remote command and returns its exit status.'],
      ]),
      h('Permissions that are checked'),
      list(
        'Client: the private key must not be readable by others (chmod 600). With 644, “WARNING: UNPROTECTED PRIVATE KEY FILE!” appears and the key is ignored.',
        'Server (StrictModes yes): the home directory, ~/.ssh and authorized_keys must not be writable by group or others; if they are, the log says “Authentication refused: bad ownership or modes”.',
        'With a passphrase, ssh asks for it (“Enter passphrase for key …”); an empty Enter moves on to the next key or to the password.',
      ),
      table(['-o option', 'Effect'], [
        ['StrictHostKeyChecking=yes|no|accept-new', 'Do not connect to unknown hosts / accept without asking / accept only new ones.'],
        ['UserKnownHostsFile=/dev/null', 'Neither read nor save known_hosts.'],
        ['PasswordAuthentication=no · PubkeyAuthentication=no', 'Disables a method on the client.'],
        ['BatchMode=yes', 'Never asks (scripts): fails if a password or passphrase would be needed.'],
      ]),
      p('With StrictHostKeyChecking=no and a changed server key, ssh warns and connects, but disables the password (“Password authentication is disabled to avoid man-in-the-middle attacks.”): you can only log in with a key pair.'),
      h('Options in authorized_keys'),
      code('from="192.168.10.*,!192.168.10.66" ssh-ed25519 AAAAC3Nza… alumno@pc0\nrestrict ssh-ed25519 AAAAC3Nza… copias@srv2'),
      list(
        'from="patterns": the key is only valid from those IPs (* and ? as wildcards, ! negates). If it does not match: “not from a permitted host” in journalctl.',
        'restrict, no-pty, no-port-forwarding, no-agent-forwarding, no-X11-forwarding and no-user-rc are accepted (Netfix does not have those features).',
        'command=, environment=, principals=, cert-authority and the rest are not implemented: the line is rejected (“bad key options”) rather than granting access without the restriction.',
      ),
      note('Netfix uses the real formats (ssh-ed25519 AAAA…, “-----BEGIN OPENSSH PRIVATE KEY-----”, SHA256:…). Inside are 256-bit Schnorr keys: the signature genuinely proves possession of the private key (the public key cannot be used to sign) and the server signs with its host key, but they are not real Ed25519/RSA keys and are of no use outside the simulator.'),
    ],
  },
  {
    id: 'srv-sshd-config',
    title: 'sshd configuration',
    summary: '/etc/ssh/sshd_config and sshd_config.d: authentication methods, allowed users and reloading the service.',
    blocks: [
      p('The Ubuntu server reads /etc/ssh/sshd_config when ssh starts and on systemctl reload|restart ssh. As in OpenSSH, the first value of each option is the one that counts, and the files in /etc/ssh/sshd_config.d/*.conf are included at the beginning, so they take precedence over anything later in the main file.'),
      table(['Option', 'Default', 'Effect'], [
        ['PasswordAuthentication', 'yes', 'Login with user name and password.'],
        ['PubkeyAuthentication', 'yes', 'Login with a key pair (~/.ssh/authorized_keys).'],
        ['AuthorizedKeysFile', '.ssh/authorized_keys .ssh/authorized_keys2', 'Key files (relative to the home directory; accepts %h and %u).'],
        ['StrictModes', 'yes', 'Rejects keys if the permissions of the home directory or ~/.ssh are insecure.'],
        ['PermitEmptyPasswords', 'no', 'Empty passwords.'],
        ['PermitRootLogin', 'prohibit-password', 'root: yes, no or keys only (prohibit-password).'],
        ['AllowUsers / DenyUsers', '—', 'Users who may (or may not) log in: user or user@IP, with * and ?. Several lines add up.'],
        ['AllowGroups / DenyGroups', '—', 'The same, by group (/etc/group).'],
        ['MaxAuthTries', '6', 'Failed attempts per connection; after that: “Too many authentication failures”.'],
      ]),
      code("root@srv:~# echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-claves.conf\nroot@srv:~# systemctl reload ssh\nalumno@pc0:~$ ssh ana@srv.aula.lab\nana@srv.aula.lab: Permission denied (publickey)."),
      list(
        'An unknown or misspelt option makes the reload fail (“Bad configuration option” in journalctl -u ssh) and the service keeps the previous configuration.',
        'Match, ForceCommand, ChrootDirectory, AuthenticationMethods and other access-control options are not implemented: sshd rejects them (“Unsupported option”) so that a lab exercise never believes something is protected when it is not.',
        'The server’s key is in /etc/ssh/ssh_host_ed25519_key (plus the ecdsa and rsa ones). If it is deleted, ssh does not start: “sshd: no hostkeys available -- exiting.”; ssh-keygen -A creates any that are missing.',
        'In the server window (Services → SSH) and in web management, the authentication switches write PasswordAuthentication and PubkeyAuthentication to sshd_config and reload ssh.',
      ),
    ],
  },
];
