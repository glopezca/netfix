/** ISP cloud: six customer lines (cable, xDSL, FTTx) joined to the emulated Internet. */
import type { NetDevice } from '../net/network.ts';
import type { Frame } from '../net/packets.ts';
import type { InternetCore, InternetEdge } from '../net/internet.ts';
import type { SimClock } from '../core/clock.ts';
import { macFromSeed } from '../core/mac.ts';
import { DETACHED, macPlus } from './hooks.ts';
import type { DeviceHooks } from './hooks.ts';
import { CloudPort } from './cloud-port.ts';
import { CLOUD_PORTS, defaultCloud, ispHop } from './cloud-config.ts';
import type { CloudDomain, CloudPortName, CloudSettings } from './cloud-config.ts';

export class Cloud implements NetDevice, InternetEdge {
  readonly kind = 'cloud' as const;
  readonly id: string;
  hooks: DeviceHooks = DETACHED;
  name: string;
  settings: CloudSettings;
  readonly lines = new Map<CloudPortName, CloudPort>();
  private readonly baseMac: string;
  private readonly clock: SimClock;
  private readonly core: InternetCore;

  constructor(opts: { id: string; name: string; clock: SimClock; seed: number; core: InternetCore; block: number }) {
    this.id = opts.id;
    this.name = opts.name;
    this.clock = opts.clock;
    this.core = opts.core;
    this.baseMac = macFromSeed(opts.seed + 104_729);
    this.settings = defaultCloud(`ISP ${opts.name}`, opts.block);
    const owner = {
      id: this.id,
      block: () => this.settings.block,
      mac: (port: string) => macPlus(this.baseMac, CLOUD_PORTS.indexOf(port as CloudPortName) + 1),
      peerUp: (port: string) => this.hooks.peerUp(port),
      transmit: (port: string, frame: Frame) => this.hooks.transmit(port, frame),
      schedule: (d: number, fn: () => void) => this.hooks.schedule(d, fn),
      now: () => this.clock.now(),
    };
    for (const p of CLOUD_PORTS) this.lines.set(p, new CloudPort(owner, opts.core, p, this.settings.ports[p]));
    opts.core.attach(this);
  }

  /** Replaces the settings (already validated) and reconfigures every line. */
  setSettings(next: CloudSettings): void {
    this.settings = next;
    for (const [name, line] of this.lines) line.apply(next.ports[name]);
  }

  /** Back on the Internet after detach() (undoing the deletion of the cloud). */
  attach(): void {
    this.core.attach(this);
  }

  detach(): void {
    this.core.detach(this);
  }

  // ------------------------------------------------------------ NetDevice

  displayName(): string {
    return this.name;
  }

  portNames(): readonly string[] {
    return CLOUD_PORTS;
  }

  portAdminUp(): boolean {
    return true;
  }

  receive(port: string, frame: Frame): void {
    this.lines.get(port as CloudPortName)?.stack.receiveFrame(port, frame);
  }

  onLinkEvent(port: string, up: boolean): void {
    if (!up) this.lines.get(port as CloudPortName)?.stack.flushArp();
  }

  ownsIp(ip: number): boolean {
    return [...this.lines.values()].some((l) => l.l3Ifaces().some((i) => i.addrs.some((a) => a.ip === ip)));
  }

  // ------------------------------------------------------------ InternetEdge

  publicBlock(): number {
    return this.settings.block;
  }

  otherBlocks(): number[] {
    return this.core.otherBlocks(this);
  }

  coreHop(): number {
    return ispHop(this.settings.block);
  }

  owns(ip: number): boolean {
    return [...this.lines.values()].some((l) => l.owns(ip));
  }

  fromInternet(packet: Parameters<InternetEdge['fromInternet']>[0]): void {
    [...this.lines.values()].find((l) => l.owns(packet.dst))?.fromInternet(packet);
  }

  domains(): readonly CloudDomain[] {
    return this.settings.domains;
  }
}
