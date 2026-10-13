/**
 * Authentication methods of sshd as the Server window and the web administration show them: they edit
 * /etc/ssh/sshd_config (PasswordAuthentication, PubkeyAuthentication) like an administrator and reload ssh.
 */
import type { Server } from '../devices/server.ts';
import { hostFs } from '../devices/host-fs.ts';
import { parseSshdConfig, setDirective, SSHD_CONFIG, DEFAULT_SSHD } from './sshd-config.ts';

export interface SshAuthMethods {
  readonly password: boolean;
  readonly pubkey: boolean;
}

/** What /etc/ssh/sshd_config says now (null when the file cannot be parsed or the server is not Ubuntu). */
export function sshAuthMethods(server: Server): SshAuthMethods | null {
  const fs = server.os === 'linux' ? hostFs(server) : undefined;
  if (!fs) return null;
  const parsed = parseSshdConfig({
    read: (p) => (fs.tryLookup(p)?.kind === 'file' ? fs.readFile(p) : null),
    list: (d) => (fs.tryLookup(d)?.kind === 'dir' ? fs.readdir(d) : []),
  });
  return parsed.ok ? { password: parsed.settings.passwordAuth, pubkey: parsed.settings.pubkeyAuth } : null;
}

const yesNo = (on: boolean): string => (on ? 'yes' : 'no');

/**
 * Writes the methods into sshd_config and reloads ssh when it is running. Returns an error (or a warning
 * when a file of sshd_config.d overrides the main file), or null.
 */
export function setSshAuthMethods(server: Server, want: SshAuthMethods): string | null {
  const fs = server.os === 'linux' ? hostFs(server) : undefined;
  if (!fs) return 'Solo los servidores Ubuntu tienen /etc/ssh/sshd_config.';
  if (!want.password && !want.pubkey) return 'Deja al menos un método de autenticación.';
  const before = fs.tryLookup(SSHD_CONFIG)?.kind === 'file' ? fs.readFile(SSHD_CONFIG) : '';
  const text = setDirective(setDirective(before, 'PasswordAuthentication', yesNo(want.password)), 'PubkeyAuthentication', yesNo(want.pubkey));
  if (text !== before) fs.writeFile(SSHD_CONFIG, text);
  const err = server.services.ssh.enabled ? server.reloadSsh() : server.ssh.reload();
  if (err) return `sshd_config tiene errores: ${err}`;
  const now = sshAuthMethods(server) ?? { password: DEFAULT_SSHD.passwordAuth, pubkey: DEFAULT_SSHD.pubkeyAuth };
  if (now.password !== want.password || now.pubkey !== want.pubkey) return 'Un fichero de /etc/ssh/sshd_config.d define antes la misma opción y es el que vale.';
  return null;
}
