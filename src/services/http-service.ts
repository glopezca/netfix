/** Static HTTP server: serves the files edited in Servicios → HTTP. */
import { t } from '../i18n/t.ts';
import type { AppPayload } from '../net/packets.ts';
import type { WebFile } from './config.ts';
import { forMethod } from '../web/http.ts';

export const SERVER_BANNER = 'Apache/2.4.62 (Ubuntu)';
export const IIS_BANNER = 'Microsoft-IIS/10.0';

type HttpRequest = Extract<AppPayload, { app: 'HTTP'; kind: 'request' }>;
type HttpResponse = Extract<AppPayload, { app: 'HTTP'; kind: 'response' }>;

const NOT_FOUND_BODY = (path: string): string => `<!doctype html>
<html><head><title>404 Not Found</title></head>
<body><h1>Not Found</h1><p>The requested URL ${escapeHtml(path)} was not found on this server.</p></body></html>`;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function contentType(name: string): string {
  if (/\.html?$/i.test(name)) return 'text/html; charset=UTF-8';
  if (/\.css$/i.test(name)) return 'text/css';
  if (/\.json$/i.test(name)) return 'application/json';
  return 'text/plain; charset=UTF-8';
}

/** Maps "/", "/index.html" and "/docs/" style paths onto the flat file list. */
export function findFile(files: readonly WebFile[], path: string): WebFile | undefined {
  const raw = path.split(/[?#]/)[0] ?? '/';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escapes (e.g. "/%") are looked up literally, as Apache does before answering 404/400.
  }
  const clean = decoded.replace(/^\/+/, '');
  const name = clean === '' || clean.endsWith('/') ? `${clean}index.html` : clean;
  return files.find((f) => f.name.toLowerCase() === name.toLowerCase());
}

export function serveHttp(files: readonly WebFile[], req: HttpRequest, banner = SERVER_BANNER): HttpResponse {
  const file = findFile(files, req.path);
  const base = { app: 'HTTP' as const, kind: 'response' as const, server: banner };
  if (!file) return forMethod(req, { ...base, status: 404, reason: 'Not Found', contentType: 'text/html; charset=iso-8859-1', body: NOT_FOUND_BODY(req.path) });
  return forMethod(req, { ...base, status: 200, reason: 'OK', contentType: contentType(file.name), body: file.content });
}

export function validateFileName(name: string, existing: readonly WebFile[]): string | null {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(name)) return t('web.err.fileName');
  if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) return t('web.err.fileExists', { name });
  return null;
}
