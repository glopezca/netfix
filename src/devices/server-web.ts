/**
 * The web side of a Server: Apache (configured in /etc/apache2) or IIS, the Roundcube webmail and
 * the web management GUI, each on its alias or port. Owns the TCP listeners of those ports.
 */
import type { Server } from './server.ts';
import type { Peer } from '../net/tcp.ts';
import type { AppPayload } from '../net/packets.ts';
import { hostFs } from './host-fs.ts';
import { loadApacheConfig } from '../services/apache/conf.ts';
import type { ApacheConfig } from '../services/apache/conf.ts';
import { serveApache } from '../services/apache/serve.ts';
import { confReader, webFs } from '../services/apache/vfs-view.ts';
import { serveHttp, SERVER_BANNER, IIS_BANNER } from '../services/http-service.ts';
import type { HttpRequest, HttpResponse } from '../web/http.ts';
import { pathOnly } from '../web/http.ts';
import type { WebAppAccess } from '../services/config.ts';
import { formatIp } from '../core/ip.ts';

const DEFAULT_HTTP_PORT = 80;

export type WebAppHandler = (server: Server, req: HttpRequest, peer: Peer, base: string) => HttpResponse;

/** Web applications (registered by src/web so that devices do not import them). */
const apps: { roundcube?: WebAppHandler; admin?: WebAppHandler } = {};

export function registerWebApp(name: 'roundcube' | 'admin', handler: WebAppHandler): void {
  apps[name] = handler;
}

function underAlias(path: string, alias: string): boolean {
  return path === alias || path.startsWith(`${alias}/`);
}

export class ServerWeb {
  config: ApacheConfig | null = null;
  private loaded = false;
  private readonly server: Server;
  private readonly listening = new Set<number>();

  constructor(server: Server) {
    this.server = server;
  }

  private linux(): boolean {
    return this.server.os !== 'windows';
  }

  /** Re-reads /etc/apache2 (systemctl start/reload/restart). On error the running configuration is kept. */
  reload(): string | null {
    const fs = this.linux() ? hostFs(this.server) : undefined;
    this.loaded = true;
    if (!fs) { this.config = null; return null; }
    const r = loadApacheConfig(confReader(fs));
    if (!r.ok) return r.error;
    this.config = r.config;
    return null;
  }

  private current(): ApacheConfig | null {
    if (!this.loaded) this.reload();
    return this.linux() ? this.config : null;
  }

  /** Ports served by Apache/IIS (plus Roundcube's own port). */
  httpPorts(): number[] {
    const s = this.server.services;
    if (!s.http.enabled) return [];
    const cfg = this.current();
    const base = cfg ? cfg.listens.map((l) => l.port) : [DEFAULT_HTTP_PORT];
    const rc = s.webapps.roundcube;
    return [...new Set([...base, ...(rc.enabled && rc.mode === 'port' ? [rc.port] : [])])].sort((a, b) => a - b);
  }

  /** The management GUI listens on its own port even when Apache is stopped. */
  adminPorts(): number[] {
    const a = this.server.services.webapps.admin;
    return a.enabled && a.mode === 'port' ? [a.port] : [];
  }

  /** Opens and closes TCP listeners to match the configuration. */
  sync(): void {
    const wanted = new Set([...this.httpPorts(), ...this.adminPorts()]);
    for (const p of this.listening) {
      if (!wanted.has(p)) { this.server.tcp.unlisten(p); this.listening.delete(p); }
    }
    for (const p of wanted) {
      if (this.listening.has(p)) continue;
      this.server.tcp.listen(p, (req, peer) => this.handle(req, peer, p));
      this.listening.add(p);
    }
  }

  private appFor(path: string, port: number): { handler: WebAppHandler; base: string } | null {
    const w = this.server.services.webapps;
    const http = this.httpPorts();
    const match = (a: WebAppAccess, needsHttp: boolean): string | null => {
      if (!a.enabled || (needsHttp && !this.server.services.http.enabled)) return null;
      if (a.mode === 'port') return port === a.port ? '' : null;
      return http.includes(port) && underAlias(path, a.alias) ? a.alias : null;
    };
    const adminBase = match(w.admin, w.admin.mode === 'alias');
    if (adminBase !== null && apps.admin) return { handler: apps.admin, base: adminBase };
    const rcBase = match(w.roundcube, true);
    if (rcBase !== null && apps.roundcube) return { handler: apps.roundcube, base: rcBase };
    return null;
  }

  handle(req: AppPayload, peer: Peer, port: number): AppPayload | null {
    if (req.app !== 'HTTP' || req.kind !== 'request') return null;
    const app = this.appFor(pathOnly(req.path), port);
    let res: HttpResponse | null;
    if (app) res = app.handler(this.server, req, peer, app.base);
    else if (!this.httpPorts().includes(port)) res = null;
    else res = this.serveStatic(req, port);
    if (res) this.server.log('http', `${formatIp(peer.ip)} - - "${req.method} ${req.path} HTTP/1.1" ${res.status} ${res.body.length}${port !== DEFAULT_HTTP_PORT ? ` (puerto ${port})` : ''}`);
    return res;
  }

  private serveStatic(req: HttpRequest, port: number): HttpResponse {
    const cfg = this.current();
    const fs = cfg ? hostFs(this.server) : undefined;
    if (!cfg || !fs) return serveHttp(this.server.services.http.files, req, this.linux() ? SERVER_BANNER : IIS_BANNER);
    return serveApache(cfg, webFs(fs), req, port, SERVER_BANNER);
  }
}
