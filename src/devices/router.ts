/** Cisco 2911-style router: routed interfaces, subinterfaces, static routes. */
import { IosDevice } from '../ios/device.ts';
import type { IfaceRuntime, ModeTable } from '../ios/device.ts';
import type { IfaceConfig } from '../ios/interfaces.ts';
import { isSubinterface, parentOf, parseIfaceName } from '../ios/interfaces.ts';
import { SimClock } from '../core/clock.ts';
import { macFromSeed } from '../core/mac.ts';
import { DETACHED, macPlus } from './hooks.ts';
import { RouterPlane } from './router-plane.ts';
import { IosWeb } from './ios-web.ts';
import { DEFAULT_TTL } from '../net/packets.ts';
import type { NetDevice } from '../net/network.ts';
import type { Frame } from '../net/packets.ts';
import type { DeviceHooks } from './hooks.ts';
import { routerModeTable } from '../ios/commands/router-modes.ts';
import { httpLines } from '../ios/http.ts';
import { headerLines, globalIpLines, interfaceSection, trailerLines } from '../ios/runconfig.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { DhcpServer } from '../dhcp/server.ts';
import { dhcpRunningConfig } from '../dhcp/config-lines.ts';

export const ROUTER_PORTS = ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2'] as const;

export interface StaticRoute {
  readonly network: number;
  readonly prefix: number;
  readonly nextHop?: number;
  readonly iface?: string;
  readonly distance: number;
}

export class Router extends IosDevice implements NetDevice {
  readonly kind = 'router' as const;
  readonly model = 'CISCO2911/K9';
  readonly id: string;
  readonly baseMac: string;
  hooks: DeviceHooks = DETACHED;
  staticRoutes: readonly StaticRoute[] = [];
  dhcp = new DhcpServer();
  plane: RouterPlane;
  readonly web: IosWeb;
  private readonly macs = new Map<string, string>();

  constructor(opts: { id?: string; clock?: SimClock; seed?: number } = {}) {
    super('Router', opts.clock ?? new SimClock());
    this.id = opts.id ?? 'R';
    this.baseMac = macFromSeed(opts.seed ?? 1);
    this.plane = new RouterPlane(this);
    this.web = new IosWeb(this, {
      send: (p) => this.plane.stack.send(p),
      sourceFor: (dst) => {
        const egress = this.plane.route(dst);
        return egress ? this.plane.l3Iface(egress.iface)?.addrs[0]?.ip : undefined;
      },
      schedule: (d, fn) => this.hooks.schedule(d, fn),
      ttl: DEFAULT_TTL,
    });
    this.resetConfig();
  }

  protected onHttpChanged(): void {
    // called from resetConfig during construction, before `web` exists
    this.web?.sync();
  }

  displayName(): string {
    return this.hostname;
  }

  portNames(): readonly string[] {
    return ROUTER_PORTS;
  }

  portAdminUp(port: string): boolean {
    return this.ifaces.get(port)?.shutdown === false;
  }

  receive(port: string, frame: Frame): void {
    this.plane.receive(port, frame);
  }

  ownsIp(ip: number): boolean {
    return this.plane.allIps().includes(ip);
  }

  dhcpLearned(name: string): { ip: number; prefix: number } | undefined {
    const lease = this.plane.leases.get(name);
    return lease ? { ip: lease.ip, prefix: lease.prefix } : undefined;
  }

  /** Re-evaluates DHCP clients on a port and its subinterfaces. */
  private syncClients(port: string): void {
    for (const name of this.sortedIfaceNames()) {
      if (name === port || parentOf(name) === port) this.plane.syncClient(name);
    }
  }

  modeTable(): ModeTable<IosDevice> {
    return routerModeTable as unknown as ModeTable<IosDevice>;
  }

  resetConfig(): void {
    this.resetGlobals('Router');
    this.staticRoutes = [];
    this.dhcp = new DhcpServer();
    this.plane = new RouterPlane(this);
    this.ifaces.clear();
    ROUTER_PORTS.forEach((p, i) => {
      this.addIface(p, { shutdown: true, switchport: false });
      this.macs.set(p, macPlus(this.baseMac, i + 1));
    });
    this.addIface('Vlan1', { shutdown: true, switchport: false });
    this.macs.set('Vlan1', macPlus(this.baseMac, ROUTER_PORTS.length + 1));
  }

  resolveIface(full: string, create: boolean): string | null {
    if (this.ifaces.has(full)) return full;
    if (!create) return null;
    const type = parseIfaceName(full)?.type;
    if (type === 'Loopback') {
      this.addIface(full, { shutdown: false, switchport: false });
      return full;
    }
    if (isSubinterface(full) && this.ifaces.has(parentOf(full))) {
      this.addIface(full, { shutdown: false, switchport: false });
      return full;
    }
    return null;
  }

  ifaceMac(name: string): string {
    return this.macs.get(parentOf(name)) ?? this.baseMac;
  }

  ifaceRuntime(name: string): IfaceRuntime {
    const cfg = this.ifaces.get(name);
    const mac = this.ifaceMac(name);
    if (!cfg || cfg.shutdown) return { mac, linkUp: false, protocolUp: false };
    if (parseIfaceName(name)?.type === 'Loopback') return { mac, linkUp: true, protocolUp: true };
    if (isSubinterface(name)) {
      const parent = this.ifaceRuntime(parentOf(name));
      return { mac, linkUp: parent.linkUp, protocolUp: parent.protocolUp };
    }
    if (name === 'Vlan1') return { mac, linkUp: false, protocolUp: false };
    const up = this.hooks.peerUp(name);
    return { mac, linkUp: up, protocolUp: up };
  }

  onIfaceChanged(name: string, before: IfaceConfig | undefined): void {
    const after = this.ifaces.get(name);
    if (before?.dhcpClient !== after?.dhcpClient || before?.address !== after?.address) this.plane.stack.flushArp(name);
    this.logStateChange(name, before, after);
    this.syncClients(name);
  }

  private logStateChange(name: string, before: IfaceConfig | undefined, after: IfaceConfig | undefined): void {
    if (!before || !after || before.shutdown === after.shutdown) return;
    if (after.shutdown) {
      this.log(`%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`);
      if (this.hooks.peerUp(parentOf(name)) || parseIfaceName(name)?.type === 'Loopback') {
        this.log(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to down`);
      }
    } else {
      const rt = this.ifaceRuntime(name);
      if (rt.linkUp || isSubinterface(name)) this.log(`%LINK-5-CHANGED: Interface ${name}, changed state to up`);
      if (rt.protocolUp) this.log(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to up`);
    }
    if (!isSubinterface(name)) this.hooks.portChanged(name);
  }

  /** Link state changed because of the far end (cable plugged, peer no shutdown...). */
  onLinkEvent(port: string, up: boolean): void {
    const cfg = this.ifaces.get(port);
    if (!cfg || cfg.shutdown) return;
    const state = up ? 'up' : 'down';
    this.log(`%LINK-5-CHANGED: Interface ${port}, changed state to ${state}`);
    this.log(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to ${state}`);
    if (!up) this.plane.stack.flushArp(port);
    this.syncClients(port);
  }

  runningConfig(): string[] {
    return [
      ...headerLines(this, '15.1'),
      ...dhcpRunningConfig(this.dhcp),
      '!',
      ...globalIpLines(this),
      'ip cef',
      'no ipv6 cef',
      '!',
      '!',
      ...interfaceSection(this),
      'ip classless',
      ...this.staticRoutes.map(routeLine),
      ...httpLines(this),
      '!',
      'ip flow-export version 9',
      ...trailerLines(this),
    ];
  }
}

function routeLine(r: StaticRoute): string {
  const target = r.nextHop !== undefined ? formatIp(r.nextHop) : (r.iface ?? '');
  const ad = r.distance !== 1 ? ` ${r.distance}` : '';
  return `ip route ${formatIp(r.network)} ${formatMask(r.prefix)} ${target}${ad}`;
}
