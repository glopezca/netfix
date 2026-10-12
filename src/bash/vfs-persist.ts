/** Saves and restores the files a user created or changed (dirty nodes) so they travel in the topology JSON. */
import type { FsNode, Vfs } from './vfs.ts';
import { MAX_FILE, MAX_TOTAL, dirname, normalize } from './vfs.ts';

export interface FileRecord {
  readonly path: string;
  readonly kind: 'file' | 'dir' | 'link';
  readonly content?: string;
  readonly target?: string;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
}

const MAX_RECORDS = 2000;
const MAX_PATH = 4096;
const MAX_LINK_TARGET = 255;
const MAX_ID = 65535;
const MODE_MASK = 0o7777;

type Dir = FsNode & { kind: 'dir' };

function walk(dir: Dir, path: string, out: FileRecord[]): void {
  if (dir.mount) return;
  for (const [name, node] of [...dir.children].sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = `${path === '/' ? '' : path}/${name}`;
    const meta = { path: p, mode: node.mode & MODE_MASK, uid: node.uid, gid: node.gid };
    if (node.kind === 'file' && node.dirty && !node.generated) out.push({ ...meta, kind: 'file', content: node.content });
    else if (node.kind === 'link' && node.dirty) out.push({ ...meta, kind: 'link', target: node.target });
    else if (node.kind === 'dir') {
      if (node.dirty) out.push({ ...meta, kind: 'dir' });
      walk(node, p, out);
    }
  }
}

/** Every node written by users, parents before children. */
export function exportFiles(fs: Vfs): FileRecord[] {
  const out: FileRecord[] = [];
  walk(fs.lookup('/') as Dir, '/', out);
  return out;
}

const isId = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_ID;

/** Keeps only well-formed records within the quotas (untrusted JSON). */
export function validFileRecords(data: unknown): FileRecord[] {
  if (!Array.isArray(data)) return [];
  const out: FileRecord[] = [];
  let total = 0;
  for (const r of data.slice(0, MAX_RECORDS) as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const { path, kind, content, target, mode, uid, gid } = r as Record<string, unknown>;
    if (typeof path !== 'string' || path.length > MAX_PATH || !path.startsWith('/') || normalize(path) !== path || path === '/') continue;
    if (!isId(uid) || !isId(gid) || typeof mode !== 'number' || !Number.isInteger(mode)) continue;
    const meta = { path, mode: mode & MODE_MASK, uid, gid };
    if (kind === 'dir') out.push({ ...meta, kind });
    else if (kind === 'link' && typeof target === 'string' && target.length <= MAX_LINK_TARGET) out.push({ ...meta, kind, target });
    else if (kind === 'file' && typeof content === 'string' && content.length <= MAX_FILE && total + content.length <= MAX_TOTAL) {
      total += content.length;
      out.push({ ...meta, kind, content });
    }
  }
  return out;
}

/** System areas a saved topology may not write: programs, devices, kernel files and the generated account files. */
const PROTECTED = /^\/(usr|bin|sbin|lib|lib64|dev|proc|sys|boot)(\/|$)|^\/etc\/(passwd|group|shadow)$/;
/** setuid and setgid bits are never restored. */
const SAFE_MODE = 0o1777;

function restorable(fs: Vfs, r: FileRecord): boolean {
  if (PROTECTED.test(r.path)) return false;
  const parent = dirname(r.path);
  try {
    // no writing through a symbolic link in the parent path
    if (fs.realpath(parent) !== parent) return false;
  } catch {
    return false;
  }
  const dir = fs.tryLookup(parent, undefined, false);
  if (dir && (dir.kind !== 'dir' || dir.mount)) return false;
  const existing = fs.tryLookup(r.path, undefined, false);
  if (existing?.kind === 'file' && existing.generated) return false;
  return !(existing?.kind === 'dir' && (existing.mount || r.kind !== 'dir'));
}

/** Recreates saved nodes (marked dirty again); generated files, service folders and system areas are never overwritten. */
export function importFiles(fs: Vfs, records: readonly FileRecord[]): void {
  for (const r of records) {
    if (!restorable(fs, r)) continue;
    const mode = r.mode & SAFE_MODE;
    try {
      if (r.kind === 'dir') fs.seed(r.path, { kind: 'dir' }, mode, r.uid, r.gid);
      else if (r.kind === 'link') fs.seed(r.path, { kind: 'link', target: r.target ?? '' }, mode, r.uid, r.gid);
      else {
        fs.seed(r.path, { kind: 'file', content: r.content ?? '' }, mode, r.uid, r.gid);
        fs.usedBytes += (r.content ?? '').length;
      }
      fs.lookup(r.path, undefined, false).dirty = true;
    } catch {
      // a parent is missing or not a directory: the record is dropped
    }
  }
}
