/**
 * The drives of one cmd.exe: C: (the device's disk) and the letters mapped with net use, each with its own current
 * folder. `Z:` makes a mapped drive the current one, cd moves through its folders (cd to another drive only sets that
 * drive's folder unless /d), and relative paths of the file commands and of > / >> start in the current folder of the
 * drive they name. When a mapping goes, so does its folder, and the terminal is back on C:.
 */
import type { Host } from '../devices/host.ts';
import { smbCall } from '../clients/smb-client.ts';
import type { Redirect } from './win-path.ts';
import { NO_DRIVE, NO_PATH } from './win-fsctx.ts';
import { smbTarget } from './win-smb.ts';
import type { SmbTarget } from './win-smb.ts';
import { smbMessage } from './win-smb-files.ts';
import type { WinFiles } from './win-files.ts';

const UNC = 'CMD does not support UNC paths as current directories.';
const LOCAL = 'C:';
const PATH_COMMANDS = new Set(['dir', 'type', 'md', 'mkdir', 'rd', 'rmdir', 'del', 'erase', 'ren', 'rename', 'copy', 'move', 'edit']);

/** A folder of a share (\dir\sub) joined with a path typed after it (.. never goes above the root). */
function join(base: string, rel: string): string {
  const parts = rel.startsWith('\\') ? [] : base.split('\\').filter(Boolean);
  for (const p of rel.split(/[\\/]+/)) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return `\\${parts.join('\\')}`;
}

const isSwitch = (a: string): boolean => a.startsWith('/');
/** The server and share a drive letter names (share names ignore case). */
const shareKey = (t: SmbTarget): string => `${t.ip}|${t.share.toLowerCase()}`;

export class WinDrives {
  private readonly host: Host;
  private current = LOCAL;
  /**
   * The current folder of each mapped drive used so far, with the share it was set on: a letter mapped again (here or
   * from another terminal of the device) to another share starts at its root.
   */
  private readonly folders = new Map<string, { readonly share: string; readonly path: string }>();

  constructor(host: Host) {
    this.host = host;
  }

  private share(drive: string): SmbTarget | null {
    const t = drive === LOCAL ? null : smbTarget(this.host, drive);
    return t && typeof t !== 'string' ? t : null;
  }

  /** The current drive: back to C: when its mapping is gone. */
  drive(): string {
    if (!this.share(this.current)) this.current = LOCAL;
    return this.current;
  }

  /** The drive's folder, while the letter still names the share it was set on (else its root). */
  private folder(drive: string): string {
    const f = this.folders.get(drive);
    const t = this.share(drive);
    return f && t && f.share === shareKey(t) ? f.path : '\\';
  }

  /** Z:\dir for the prompt; null on C: (the local file commands know where they are). */
  here(): string | null {
    const d = this.drive();
    return d === LOCAL ? null : `${d}${this.folder(d)}`;
  }

  /** `X:` alone: that drive becomes the current one. */
  select(input: string): string[] {
    const d = input.toUpperCase();
    if (d !== LOCAL && !this.share(d)) return [NO_DRIVE];
    this.current = d;
    return [];
  }

  /** A path as the share commands need it: Z:\full\path when it is on a mapped drive, else as typed. */
  full(input: string): string {
    if (isSwitch(input) || input.startsWith('\\\\')) return input;
    const m = /^([a-z]):(.*)$/i.exec(input);
    const d = m ? `${(m[1] ?? '').toUpperCase()}:` : this.drive();
    if (d === LOCAL || !this.share(d) || (!m && input.toLowerCase() === 'nul')) return input;
    return `${d}${join(this.folder(d), m ? m[2] ?? '' : input)}`;
  }

  /** The operands of a file command made absolute on mapped drives (ren's new name is a name, not a path). */
  paths(cmd: string, args: readonly string[]): string[] {
    if (!PATH_COMMANDS.has(cmd)) return [...args];
    let seen = 0;
    const out = args.map((a) => (isSwitch(a) || (seen++ > 0 && (cmd === 'ren' || cmd === 'rename')) ? a : this.full(a)));
    const here = this.here();
    const operands = args.filter((a) => !isSwitch(a)).length;
    // dir alone lists the current folder; copy or move of one operand writes there.
    if (here && ((cmd === 'dir' && !operands) || ((cmd === 'copy' || cmd === 'move') && operands === 1))) out.push(here);
    return out;
  }

  /** cd / chdir: on a mapped drive here; on C: by the local file commands. */
  cd(args: readonly string[], local: WinFiles): string[] {
    const switchDrive = args.some((a) => a.toLowerCase() === '/d');
    const target = args.filter((a) => a.toLowerCase() !== '/d').join(' ');
    if (target.startsWith('\\\\')) return [UNC];
    const m = /^([a-z]):(.*)$/i.exec(target);
    const d = m ? `${(m[1] ?? '').toUpperCase()}:` : this.drive();
    if (d === LOCAL) {
      const out = local.run('cd', args, '') ?? [];
      if (switchDrive && !out.length) this.current = LOCAL;
      return out;
    }
    const t = this.share(d);
    if (!t) return [NO_DRIVE];
    const rest = m ? m[2] ?? '' : target;
    if (!rest) {
      if (!switchDrive) return [`${d}${this.folder(d)}`];
      this.current = d;
      return [];
    }
    const path = join(this.folder(d), rest);
    const err = path === '\\' ? null : this.notFolder(t, path);
    if (err) return [err];
    this.folders.set(d, { share: shareKey(t), path });
    if (switchDrive) this.current = d;
    return [];
  }

  private notFolder(t: SmbTarget, path: string): string | null {
    const r = smbCall(this.host, t.ip, t.login, t.share, { op: 'stat', path });
    if (r.status !== 'NT_STATUS_OK') return smbMessage(r.status, NO_PATH);
    return r.entry?.dir ? null : 'The directory name is invalid.';
  }

  /** > or >> onto a share (mapped drive or UNC path); null when the file is local. */
  redirect(r: Redirect, lines: readonly string[]): string[] | null {
    const t = smbTarget(this.host, this.full(r.path));
    if (t === null) return null;
    if (typeof t === 'string') return [t];
    const call = (req: Parameters<typeof smbCall>[4]): ReturnType<typeof smbCall> => smbCall(this.host, t.ip, t.login, t.share, req);
    let before = '';
    if (r.append) {
      const old = call({ op: 'read', path: t.path });
      if (old.status === 'NT_STATUS_OK') before = old.data ?? '';
      else if (old.status !== 'NT_STATUS_OBJECT_NAME_NOT_FOUND') return [smbMessage(old.status, NO_PATH)];
    }
    const w = call({ op: 'write', path: t.path, data: `${before}${lines.length ? `${lines.join('\n')}\n` : ''}` });
    return w.status === 'NT_STATUS_OK' ? [] : [smbMessage(w.status, NO_PATH)];
  }
}
