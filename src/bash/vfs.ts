/**
 * In-memory Unix file system for one host: directories, files, symlinks and devices with
 * owner/group/mode permissions. Generated files are read-only mounts; a directory can be backed
 * by a service (e.g. /var/www/html ↔ HTTP files). Nodes written by the user are marked dirty.
 */

export interface Cred {
  readonly uid: number;
  readonly gid: number;
  readonly groups?: readonly number[];
}

export const ROOT: Cred = { uid: 0, gid: 0 };

export type FsCode = 'ENOENT' | 'EACCES' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EROFS' | 'EINVAL' | 'EFBIG' | 'ENOSPC' | 'ELOOP' | 'EPERM';

const MESSAGES: Readonly<Record<FsCode, string>> = {
  ENOENT: 'No such file or directory', EACCES: 'Permission denied', EEXIST: 'File exists', ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory', ENOTEMPTY: 'Directory not empty', EROFS: 'Read-only file system', EINVAL: 'Invalid argument',
  EFBIG: 'File too large', ENOSPC: 'No space left on device', ELOOP: 'Too many levels of symbolic links', EPERM: 'Operation not permitted',
};

export class FsError extends Error {
  readonly code: FsCode;
  constructor(code: FsCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

/** Service-backed directory (files only). */
export interface DirMount {
  list(): string[];
  read(name: string): string | undefined;
  write(name: string, content: string): void;
  remove(name: string): void;
}

interface Meta {
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  dirty?: boolean;
}

export type FsNode =
  | (Meta & { kind: 'file'; content: string; generated?: () => string })
  | (Meta & { kind: 'dir'; children: Map<string, FsNode>; mount?: DirMount })
  | (Meta & { kind: 'link'; target: string })
  | (Meta & { kind: 'dev'; dev: string });

export interface StatInfo {
  readonly kind: FsNode['kind'];
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly size: number;
  readonly mtime: number;
  readonly generated: boolean;
}

export const MAX_FILE = 256 * 1024;
export const MAX_TOTAL = 4 * 1024 * 1024;
const MAX_LINKS = 16;
const MAX_TOTAL_LINKS = 40;

export function normalize(path: string, cwd = '/'): string {
  const parts: string[] = [];
  for (const p of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return `/${parts.join('/')}`;
}

export function dirname(path: string): string {
  const n = normalize(path);
  return n === '/' ? '/' : n.slice(0, n.lastIndexOf('/')) || '/';
}

export function basename(path: string): string {
  const n = normalize(path);
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
}

export function canAccess(node: Meta, cred: Cred, bit: 4 | 2 | 1): boolean {
  if (cred.uid === 0) return bit !== 1 || (node.mode & 0o111) !== 0 || (node as { kind?: string }).kind === 'dir';
  const shift = cred.uid === node.uid ? 6 : cred.gid === node.gid || cred.groups?.includes(node.gid) ? 3 : 0;
  return ((node.mode >> shift) & bit) !== 0;
}

export class Vfs {
  readonly root: FsNode & { kind: 'dir' };
  private readonly now: () => number;
  usedBytes = 0;

  constructor(now: () => number = () => 0) {
    this.now = now;
    this.root = { kind: 'dir', children: new Map(), mode: 0o755, uid: 0, gid: 0, mtime: now() };
  }

  // ------------------------------------------------------------ lookup

  /** Walks a normalized path; returns the node or throws. `follow` resolves a final symlink. */
  lookup(path: string, cred: Cred = ROOT, follow = true): FsNode {
    const p = normalize(path);
    const real = follow ? this.realpath(p) : p === '/' ? '/' : normalize(basename(p), this.realpath(dirname(p)));
    let node: FsNode = this.root;
    for (const name of real.split('/').filter(Boolean)) {
      if (node.kind !== 'dir') throw new FsError('ENOTDIR');
      if (!canAccess(node, cred, 1)) throw new FsError('EACCES');
      const child = this.child(node, name);
      if (!child) throw new FsError('ENOENT');
      node = child;
    }
    return node;
  }

  /** Node at a path without following any symlink and without permission checks. */
  private raw(path: string): FsNode | undefined {
    let node: FsNode | undefined = this.root;
    for (const name of path.split('/').filter(Boolean)) {
      if (node?.kind !== 'dir') return undefined;
      node = this.child(node, name);
    }
    return node;
  }

  /** Path with symlinks resolved (for cd -P, realpath, pwd -P). */
  realpath(path: string): string {
    return this.resolveLinks(path, 0, { links: 0 });
  }

  /** `budget` counts every link followed in this resolution (Linux allows 40), so chains cannot explode. */
  private resolveLinks(path: string, depth: number, budget: { links: number }): string {
    if (depth > MAX_LINKS) throw new FsError('ELOOP');
    let resolved = '/';
    for (const p of normalize(path).split('/').filter(Boolean)) {
      const next = normalize(p, resolved);
      const node = this.raw(next);
      if (node?.kind !== 'link') { resolved = next; continue; }
      if (++budget.links > MAX_TOTAL_LINKS) throw new FsError('ELOOP');
      resolved = this.resolveLinks(normalize(node.target, resolved), depth + 1, budget);
    }
    return resolved;
  }

  tryLookup(path: string, cred: Cred = ROOT, follow = true): FsNode | undefined {
    try {
      return this.lookup(path, cred, follow);
    } catch {
      return undefined;
    }
  }

  private child(dir: FsNode & { kind: 'dir' }, name: string): FsNode | undefined {
    const own = dir.children.get(name);
    if (own || !dir.mount) return own;
    const content = dir.mount.read(name);
    if (content === undefined) return undefined;
    const mount = dir.mount;
    return { kind: 'file', content, mode: 0o644, uid: 0, gid: 0, mtime: dir.mtime, generated: () => mount.read(name) ?? '' };
  }

  exists(path: string): boolean {
    return this.tryLookup(path) !== undefined;
  }

  stat(path: string, cred: Cred = ROOT, follow = true): StatInfo {
    const n = this.lookup(path, cred, follow);
    const size = n.kind === 'file' ? new TextEncoder().encode(this.contentOf(n)).length : n.kind === 'dir' ? 4096 : n.kind === 'link' ? n.target.length : 0;
    return { kind: n.kind, mode: n.mode, uid: n.uid, gid: n.gid, size, mtime: n.mtime, generated: n.kind === 'file' && Boolean(n.generated) };
  }

  private contentOf(n: FsNode & { kind: 'file' }): string {
    return n.generated ? n.generated() : n.content;
  }

  // ------------------------------------------------------------ files

  readFile(path: string, cred: Cred = ROOT): string {
    const n = this.lookup(path, cred);
    if (n.kind === 'dir') throw new FsError('EISDIR');
    if (n.kind === 'dev') return n.dev === 'zero' ? '\0'.repeat(1024) : '';
    if (n.kind !== 'file') throw new FsError('EINVAL');
    if (!canAccess(n, cred, 4)) throw new FsError('EACCES');
    return this.contentOf(n);
  }

  /** Creates or replaces (or appends to) a regular file. */
  writeFile(path: string, content: string, cred: Cred = ROOT, append = false, mode = 0o664): void {
    const p = normalize(path);
    const existing = this.tryLookup(p, cred);
    if (existing?.kind === 'dev') return;
    if (existing?.kind === 'dir') throw new FsError('EISDIR');
    const parentPath = dirname(existing ? this.realpath(p) : p);
    const parent = this.lookup(parentPath, cred);
    if (parent.kind !== 'dir') throw new FsError('ENOTDIR');
    const name = basename(existing ? this.realpath(p) : p);
    if (parent.mount) return this.writeMounted(parent, name, content, cred, append);
    if (existing?.kind === 'file') return this.overwrite(existing, content, cred, append);
    if (!canAccess(parent, cred, 2) || !canAccess(parent, cred, 1)) throw new FsError('EACCES');
    this.charge(content.length);
    parent.children.set(name, { kind: 'file', content, mode: cred.uid === 0 ? 0o644 : mode, uid: cred.uid, gid: cred.gid, mtime: this.now(), dirty: true });
    parent.mtime = this.now();
  }

  private overwrite(node: FsNode & { kind: 'file' }, content: string, cred: Cred, append: boolean): void {
    if (node.generated) throw new FsError('EROFS');
    if (!canAccess(node, cred, 2)) throw new FsError('EACCES');
    const next = append ? node.content + content : content;
    if (next.length > MAX_FILE) throw new FsError('EFBIG');
    this.charge(next.length - node.content.length);
    node.content = next;
    node.mtime = this.now();
    node.dirty = true;
  }

  private writeMounted(dir: FsNode & { kind: 'dir'; mount?: DirMount }, name: string, content: string, cred: Cred, append: boolean): void {
    if (!canAccess(dir, cred, 2)) throw new FsError('EACCES');
    if (content.length > MAX_FILE) throw new FsError('EFBIG');
    const mount = dir.mount as DirMount;
    mount.write(name, append ? (mount.read(name) ?? '') + content : content);
  }

  private charge(bytes: number): void {
    if (this.usedBytes + bytes > MAX_TOTAL) throw new FsError('ENOSPC');
    this.usedBytes = Math.max(0, this.usedBytes + bytes);
  }

  // ------------------------------------------------------------ directories

  readdir(path: string, cred: Cred = ROOT): string[] {
    const n = this.lookup(path, cred);
    if (n.kind !== 'dir') throw new FsError('ENOTDIR');
    if (!canAccess(n, cred, 4)) throw new FsError('EACCES');
    const names = new Set([...n.children.keys(), ...(n.mount?.list() ?? [])]);
    return [...names].sort();
  }

  mkdir(path: string, cred: Cred = ROOT, parents = false, mode = 0o775): void {
    const p = normalize(path);
    const existing = this.tryLookup(p, cred);
    if (existing) {
      if (parents && existing.kind === 'dir') return;
      throw new FsError('EEXIST');
    }
    const parentPath = dirname(p);
    if (parents && !this.tryLookup(parentPath, cred)) this.mkdir(parentPath, cred, true, mode);
    const parent = this.lookup(parentPath, cred);
    if (parent.kind !== 'dir') throw new FsError('ENOTDIR');
    if (parent.mount) throw new FsError('EPERM');
    if (!canAccess(parent, cred, 2)) throw new FsError('EACCES');
    parent.children.set(basename(p), { kind: 'dir', children: new Map(), mode: cred.uid === 0 ? 0o755 : mode, uid: cred.uid, gid: cred.gid, mtime: this.now(), dirty: true });
  }

  /** Removes a file, link or (empty unless `recursive`) directory. */
  remove(path: string, cred: Cred = ROOT, recursive = false, dirAllowed = false): void {
    const p = normalize(path);
    if (p === '/') throw new FsError('EPERM');
    const parent = this.lookup(dirname(p), cred);
    if (parent.kind !== 'dir') throw new FsError('ENOTDIR');
    const name = basename(p);
    const node = parent.children.get(name) ?? (parent.mount && parent.mount.read(name) !== undefined ? undefined : null);
    if (node === null) throw new FsError('ENOENT');
    if (!canAccess(parent, cred, 2)) throw new FsError('EACCES');
    if (node === undefined) return parent.mount?.remove(name);
    if ((parent.mode & 0o1000) && cred.uid !== 0 && node.uid !== cred.uid && parent.uid !== cred.uid) throw new FsError('EPERM');
    if (node.kind === 'file' && node.generated) throw new FsError('EROFS');
    if (node.kind === 'dir') {
      if (!dirAllowed && !recursive) throw new FsError('EISDIR');
      if (node.mount) throw new FsError('EPERM');
      if (node.children.size && !recursive) throw new FsError('ENOTEMPTY');
      for (const c of [...node.children.keys()]) this.remove(`${p}/${c}`, cred, true, true);
    }
    if (node.kind === 'file') this.charge(-node.content.length);
    parent.children.delete(name);
    parent.mtime = this.now();
  }

  rename(from: string, to: string, cred: Cred = ROOT): void {
    const src = normalize(from);
    const node = this.lookup(src, cred, false);
    const dst = this.tryLookup(to, cred)?.kind === 'dir' ? normalize(basename(src), normalize(to)) : normalize(to);
    if (dst === src) return;
    if (dst.startsWith(`${src}/`)) throw new FsError('EINVAL');
    const target = this.lookup(dirname(dst), cred);
    const parent = this.lookup(dirname(src), cred);
    if (target.kind !== 'dir' || parent.kind !== 'dir') throw new FsError('ENOTDIR');
    if (node.kind === 'file' && (target.mount || parent.mount)) {
      // service-backed folders (/var/www/html) only hold contents: copy, then remove
      this.writeFile(dst, this.contentOf(node), cred);
      this.remove(src, cred);
      return;
    }
    if (target.mount) throw new FsError('EPERM');
    if (node.kind === 'file' && node.generated) throw new FsError('EROFS');
    if (!canAccess(target, cred, 2) || !canAccess(parent, cred, 2)) throw new FsError('EACCES');
    const existing = target.children.get(basename(dst));
    if (existing?.kind === 'dir' && node.kind !== 'dir') throw new FsError('EISDIR');
    if (existing?.kind === 'file' && existing.generated) throw new FsError('EROFS');
    if (existing?.kind === 'file') this.charge(-existing.content.length);
    parent.children.delete(basename(src));
    target.children.set(basename(dst), { ...node, dirty: true });
  }

  symlink(target: string, path: string, cred: Cred = ROOT): void {
    const p = normalize(path);
    if (this.tryLookup(p, cred, false)) throw new FsError('EEXIST');
    const parent = this.lookup(dirname(p), cred);
    if (parent.kind !== 'dir' || parent.mount) throw new FsError('EPERM');
    if (!canAccess(parent, cred, 2)) throw new FsError('EACCES');
    parent.children.set(basename(p), { kind: 'link', target, mode: 0o777, uid: cred.uid, gid: cred.gid, mtime: this.now(), dirty: true });
  }

  chmod(path: string, mode: number, cred: Cred = ROOT): void {
    const n = this.lookup(path, cred);
    if (cred.uid !== 0 && n.uid !== cred.uid) throw new FsError('EPERM');
    if (n.kind === 'file' && n.generated) throw new FsError('EROFS');
    n.mode = mode & 0o7777;
    n.dirty = true;
  }

  chown(path: string, uid: number, gid: number, cred: Cred = ROOT): void {
    const n = this.lookup(path, cred);
    if (cred.uid !== 0) throw new FsError('EPERM');
    n.uid = uid;
    n.gid = gid;
    n.dirty = true;
  }

  touch(path: string, cred: Cred = ROOT): void {
    const n = this.tryLookup(path, cred);
    if (!n) return this.writeFile(path, '', cred);
    if (cred.uid !== 0 && n.uid !== cred.uid && !canAccess(n, cred, 2)) throw new FsError('EACCES');
    n.mtime = this.now();
  }

  // ------------------------------------------------------------ setup helpers (as root)

  /** Adds or replaces a read-only generated file, creating parent directories. */
  mountFile(path: string, read: () => string, mode = 0o644): void {
    const p = normalize(path);
    this.mkdir(dirname(p), ROOT, true);
    const parent = this.lookup(dirname(p)) as FsNode & { kind: 'dir' };
    parent.children.set(basename(p), { kind: 'file', content: '', generated: read, mode, uid: 0, gid: 0, mtime: this.now() });
  }

  unmountFile(path: string): void {
    const p = normalize(path);
    const parent = this.tryLookup(dirname(p));
    const node = parent?.kind === 'dir' ? parent.children.get(basename(p)) : undefined;
    if (parent?.kind === 'dir' && node?.kind === 'file' && node.generated) parent.children.delete(basename(p));
  }

  mountDir(path: string, mount: DirMount, mode = 0o755): void {
    this.mkdir(path, ROOT, true);
    const n = this.lookup(path) as FsNode & { kind: 'dir' };
    n.mount = mount;
    n.mode = mode;
  }

  /** Creates a node as root without marking it dirty (skeleton). */
  seed(path: string, node: { kind: 'file'; content: string } | { kind: 'dir' } | { kind: 'link'; target: string } | { kind: 'dev'; dev: string }, mode?: number, uid = 0, gid = 0): void {
    const p = normalize(path);
    if (p !== '/' && !this.tryLookup(dirname(p))) this.mkdir(dirname(p), ROOT, true);
    const parent = this.lookup(dirname(p)) as FsNode & { kind: 'dir' };
    const meta = { uid, gid, mtime: this.now() };
    const full: FsNode = node.kind === 'dir'
      ? { kind: 'dir', children: (parent.children.get(basename(p)) as { children?: Map<string, FsNode> } | undefined)?.children ?? new Map(), mode: mode ?? 0o755, ...meta }
      : node.kind === 'file' ? { kind: 'file', content: node.content, mode: mode ?? 0o644, ...meta }
        : node.kind === 'link' ? { kind: 'link', target: node.target, mode: 0o777, ...meta } : { kind: 'dev', dev: node.dev, mode: mode ?? 0o666, ...meta };
    if (p === '/') return;
    parent.children.set(basename(p), full);
  }
}
