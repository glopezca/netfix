/**
 * The HTTP server of a Cisco router or switch (`ip http server`): a TCP listener on the configured port
 * whose pages come from src/web/ios-web.ts (registered there so that devices do not import web code).
 */
import type { IosDevice } from '../ios/device.ts';
import { TcpLayer } from '../net/tcp.ts';
import type { Peer, TcpEnv } from '../net/tcp.ts';
import type { AppPayload } from '../net/packets.ts';
import type { HttpRequest, HttpResponse } from '../web/http.ts';

export type IosWebHandler = (device: IosDevice, req: HttpRequest, peer: Peer) => HttpResponse;

let handler: IosWebHandler | undefined;

export function registerIosWeb(h: IosWebHandler): void {
  handler = h;
}

export class IosWeb {
  readonly tcp: TcpLayer;
  private readonly device: IosDevice;
  private port: number | undefined;

  constructor(device: IosDevice, env: TcpEnv) {
    this.device = device;
    this.tcp = new TcpLayer(env);
  }

  /** Opens, moves or closes the listener after `ip http server|port`. */
  sync(): void {
    const want = this.device.http.server ? this.device.http.port : undefined;
    if (want === this.port) return;
    if (this.port !== undefined) this.tcp.unlisten(this.port);
    this.port = want;
    if (want !== undefined) this.tcp.listen(want, (req, peer) => this.handle(req, peer));
  }

  listeningPort(): number | undefined {
    return this.port;
  }

  private handle(req: AppPayload, peer: Peer): AppPayload | null {
    if (req.app !== 'HTTP' || req.kind !== 'request' || !handler) return null;
    return handler(this.device, req, peer);
  }
}
