// Minimal static server (no dependencies).
// Default: serves dist/. With no dist/ (e.g. a fresh Codespace) it serves the prebuilt
// netsim.html from the repository root, so nothing needs to be built first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const builtDir = join(repoRoot, 'dist');
const useDist = existsSync(join(builtDir, 'index.html')) && !process.argv.includes('--prebuilt');
const dist = useDist ? builtDir : repoRoot;
const indexFile = useDist ? 'index.html' : 'netsim.html';
const port = Number(process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = join(dist, rel === '' ? indexFile : rel);
  // In prebuilt mode only the single HTML file is exposed, never the rest of the repository.
  const allowed = useDist ? file.startsWith(dist) : file === join(dist, indexFile);
  if (!allowed) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => process.stdout.write(`netsim en http://localhost:${port} (${useDist ? 'dist/' : 'netsim.html precompilado'})\n`));
