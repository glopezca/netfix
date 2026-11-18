/**
 * Classroom LAN (Netfix Classroom only): one port that joins this lab to the others open in the class, through the
 * host's relay (net/classlan.ts).
 *  - NAT (default): a router like the ISP cloud's in router mode — LAN gateway, DHCP, NAT to its classroom address
 *    10.lab.1.2 and port forwarding; IP packets go to and come from the other labs' addresses.
 *  - Bridge: the port is a segment shared by every lab in bridge mode; frames go out and come in as they are (address
 *    clashes between labs can happen, as on a real switch).
 * Without a link (a file opened outside Netfix Classroom) it keeps its settings and is simply disconnected.
 */
import type { NetDevice } from '../net/network.ts';
import type { Frame, IpPacket } from '../net/packets.ts';
import type { SimClock } from '../core/clock.ts';
import { DETACHED, macPlus } from './hooks.ts';
import type { DeviceHooks } from './hooks.ts';
import { macFromSeed } from '../core/mac.ts';
import { CloudPort } from './cloud-port.ts';
import type { CloudPortSettings } from './cloud-config.ts';
import { defaultPort, portFromJson, portToJson, validatePort } from './cloud-config.ts';
import { classLanMessage, labBlock } from '../net/classlan.ts';
import type { ClassLanLink, ClassLanMessage } from '../net/classlan.ts';

export const CLASSLAN_PORT = 'Ethernet0';
/** The line name the shared router code uses for its addresses (the first line of a /16: x.y.1.0/29). */
const LINE = 'Coaxial0';
export type ClassLanMode = 'nat' | 'bridge';

export interface ClassLanSettings {
  readonly mode: ClassLanMode;
  /** NAT mode: the router's LAN, DHCP and port forwarding (as a cloud line in router mode). */
  readonly router: CloudPortSettings;
}

export function defaultClassLan(): ClassLanSettings {
  return { mode: 'nat', router: defaultPort(LINE) };
}

export function classLanToJson(s: ClassLanSettings): unknown {
  return { mode: s.mode, router: portToJson(s.router) };
}

/** Settings from an untrusted file; anything invalid falls back to the defaults. */
export function classLanFromJson(v: unknown): ClassLanSettings {
  const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
  const router = portFromJson(LINE, o.router);
  return { mode: o.mode === 'bridge' ? 'bridge' : 'nat', router: { ...router, mode: 'router' } };
}

export class ClassLan implements NetDevice {
  readonly kind = 'classlan' as const;
  readonly id: string;
  hooks: DeviceHooks = DETACHED;
  name: string;
  settings: ClassLanSettings = defaultClassLan();
  /** The NAT router (only used in NAT mode). */
  readonly router: CloudPort;
  private readonly clock: SimClock;
  private readonly mac: string;
  private link: ClassLanLink | null = null;
  private stopListening: (() => void) | null = null;

  constructor(opts: { id: string; name: string; clock: SimClock; seed: number }) {
    this.id = opts.id;
    this.name = opts.name;
    this.clock = opts.clock;
    this.mac = macFromSeed(opts.seed + 7_919);
    const owner = {
      id: this.id,
      block: () => labBlock(this.link?.lab ?? 0),
      mac: () => macPlus(this.mac, 1),
      peerUp: () => this.hooks.peerUp(CLASSLAN_PORT),
      transmit: (_port: string, frame: Frame) => this.hooks.transmit(CLASSLAN_PORT, frame),
      schedule: (d: number, fn: () => void) => this.hooks.schedule(d, fn),
      now: () => this.clock.now(),
    };
    this.router = new CloudPort(owner, { send: (p: IpPacket) => this.send({ kind: 'ip', packet: p }) }, LINE, this.settings.router);
  }

  /** Joins (or leaves, with null) the class's LAN; the router's classroom address follows the lab's number. */
  connect(link: ClassLanLink | null): void {
    this.stopListening?.();
    this.stopListening = null;
    this.link = link;
    this.router.apply(this.settings.router);
    if (link) this.stopListening = link.onMessage((m) => this.fromClass(m));
  }

  /** connect() that returns the device (for building it in one expression). */
  connectTo(link: ClassLanLink | null): this {
    this.connect(link);
    return this;
  }

  connected(): boolean {
    return this.link !== null;
  }

  /** The router's classroom address (NAT mode), or null when not in a class. */
  classAddress(): number | null {
    return this.link ? this.router.wan() : null;
  }

  /** Replaces the settings (checked first); a new mode or router setting starts the router afresh. */
  setSettings(next: ClassLanSettings): string | null {
    const router: CloudPortSettings = { ...next.router, mode: 'router' };
    const err = validatePort(router);
    if (err) return err;
    this.settings = { mode: next.mode, router };
    this.router.apply(router);
    return null;
  }

  private send(message: ClassLanMessage): void {
    this.link?.send(message);
  }

  /** From another lab: checked, then delivered on the next tick (never inside the relay's callback). */
  private fromClass(raw: unknown): void {
    const m = classLanMessage(raw);
    if (!m) return;
    this.hooks.schedule(0, () => {
      try {
        if (m.kind === 'frame' && this.settings.mode === 'bridge') this.hooks.transmit(CLASSLAN_PORT, m.frame);
        else if (m.kind === 'ip' && this.settings.mode === 'nat' && this.router.owns(m.packet.dst)) this.router.fromInternet(m.packet);
      } catch {
        // A frame built by hand in another browser that the simulation cannot handle: dropped, this lab goes on.
      }
    });
  }

  // ------------------------------------------------------------ NetDevice

  displayName(): string {
    return this.name;
  }

  portNames(): readonly string[] {
    return [CLASSLAN_PORT];
  }

  portAdminUp(): boolean {
    return true;
  }

  receive(_port: string, frame: Frame): void {
    if (this.settings.mode === 'bridge') this.send({ kind: 'frame', frame });
    else this.router.stack.receiveFrame(LINE, frame);
  }

  onLinkEvent(_port: string, up: boolean): void {
    if (!up) this.router.stack.flushArp();
  }

  ownsIp(ip: number): boolean {
    return this.settings.mode === 'nat' && this.router.l3Ifaces().some((i) => i.addrs.some((a) => a.ip === ip));
  }
}
