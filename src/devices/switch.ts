/** Cisco 2960-style L2 switch: VLANs, access/trunk ports, MAC learning, spanning tree, SVI and DHCP snooping. */
import { IosDevice } from '../ios/device.ts';
import type { IfaceRuntime, ModeTable } from '../ios/device.ts';
import type { IfaceConfig } from '../ios/interfaces.ts';
import { parseIfaceName, shortIfaceName } from '../ios/interfaces.ts';
import { SimClock } from '../core/clock.ts';
import { macFromSeed, BROADCAST_MAC, formatMacCisco, asciiToHex } from '../core/mac.ts';
import type { IpWithPrefix } from '../core/ip.ts';
import { inSubnet, formatIp, formatMask, BROADCAST_IP } from '../core/ip.ts';
import { DETACHED } from './hooks.ts';
import type { DeviceHooks } from './hooks.ts';
import type { NetDevice } from '../net/network.ts';
import type { Frame, IpPacket } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DEFAULT_TTL } from '../net/packets.ts';
import { IpStack } from '../net/ipstack.ts';
import { IosWeb } from './ios-web.ts';
import { httpLines } from '../ios/http.ts';
import type { L3Iface, StackHost, Egress } from '../net/ipstack.ts';
import { DhcpClient } from '../dhcp/client.ts';
import type { Lease } from '../dhcp/client.ts';
import { Snooping } from './snooping.ts';
import { switchModeTable } from '../ios/commands/switch-modes.ts';
import { SWITCH_PORTS, DEFAULT_VLANS } from './switch-ports.ts';
import { StpConfig } from './stp-config.ts';
import type { StpBridge, StpResult, StpVlan } from '../net/stp.ts';
import { forwardingKeys } from '../net/stp.ts';

export { SWITCH_PORTS, DEFAULT_VLANS };
import { headerLines, globalIpLines, interfaceSection, trailerLines } from '../ios/runconfig.ts';

const MAX_L2_HOPS = 32;

type HopFrame = Frame & { readonly l2hops?: number };

export class Switch extends IosDevice implements NetDevice, StackHost {
  readonly kind = 'switch' as const;
  readonly model = 'WS-C2960-24TT-L';
  readonly id: string;
  readonly baseMac: string;
  hooks: DeviceHooks = DETACHED;
  vlans = new Map<number, string>(DEFAULT_VLANS);
  defaultGateway: number | undefined;
  readonly macTable = new Map<string, { mac: string; vlan: number; port: string }>();
  readonly snooping = new Snooping();
  readonly stp = new StpConfig();
  /** The last spanning tree seen, and the forwarding ports of each VLAN in the whole network then. */
  private stpSeen: { readonly tree: StpResult; readonly keys: ReadonlyMap<number, string> } | undefined;
  readonly stack: IpStack;
  readonly web: IosWeb;
  readonly dropOnArpMiss = true;
  readonly ttl = DEFAULT_TTL;
  private readonly clients = new Map<string, DhcpClient>();
  readonly leases = new Map<string, Lease>();

  constructor(opts: { id?: string; clock?: SimClock; seed?: number } = {}) {
    super('Switch', opts.clock ?? new SimClock());
    this.id = opts.id ?? 'S';
    this.baseMac = macFromSeed((opts.seed ?? 1) + 7919);
    this.stack = new IpStack(this, () => this.clock.now());
    this.web = new IosWeb(this, {
      send: (p) => this.stack.send(p),
      sourceFor: (dst) => {
        const egress = this.route(dst);
        return egress ? this.l3Iface(egress.iface)?.addrs[0]?.ip : undefined;
      },
      schedule: (d, fn) => this.schedule(d, fn),
      ttl: DEFAULT_TTL,
    });
    this.resetConfig();
  }

  protected onHttpChanged(): void {
    // called from resetConfig during construction, before `web` exists
    this.web?.sync();
  }

  modeTable(): ModeTable<IosDevice> {
    return switchModeTable as unknown as ModeTable<IosDevice>;
  }

  resetConfig(): void {
    this.resetGlobals('Switch');
    this.defaultGateway = undefined;
    this.vlans = new Map(DEFAULT_VLANS);
    this.snooping.reset();
    this.stp.reset();
    this.clearIfaces();
    this.macTable.clear();
    for (const p of SWITCH_PORTS) this.addIface(p, { shutdown: false, switchport: true });
    this.addIface('Vlan1', { shutdown: true, switchport: false });
    this.stpChanged();
  }

  displayName(): string {
    return this.hostname;
  }

  ensureVlan(id: number): boolean {
    if (this.vlans.has(id)) return false;
    this.vlans.set(id, `VLAN${String(id).padStart(4, '0')}`);
    this.stpChanged();
    return true;
  }

  resolveIface(full: string, create: boolean): string | null {
    if (this.ifaces.has(full)) return full;
    const parsed = parseIfaceName(full);
    if (!create || parsed?.type !== 'Vlan') return null;
    const id = Number(parsed.number);
    if (!(id >= 1 && id <= 4094)) return null;
    this.addIface(full, { shutdown: false, switchport: false });
    return full;
  }

  // ------------------------------------------------------------ status

  ifaceRuntime(name: string): IfaceRuntime {
    const cfg = this.ifaces.get(name);
    if (!cfg || cfg.shutdown) return { mac: this.baseMac, linkUp: false, protocolUp: false };
    if (!cfg.switchport) {
      const vlan = Number(parseIfaceName(name)?.number ?? 0);
      const up = this.vlans.has(vlan) && this.portsInVlan(vlan).some((p) => this.portUp(p));
      return { mac: this.baseMac, linkUp: up, protocolUp: up };
    }
    const up = this.portUp(name);
    return { mac: this.baseMac, linkUp: up, protocolUp: up };
  }

  private portUp(port: string): boolean {
    return this.portAdminUp(port) && this.hooks.peerUp(port);
  }

  isTrunk(port: string): boolean {
    const mode = this.ifaces.get(port)?.switchportMode;
    if (mode === 'trunk') return true;
    if (mode === 'access') return false;
    return this.hooks.peerTrunking(port);
  }

  configuredTrunk(port: string): boolean {
    return this.ifaces.get(port)?.switchportMode === 'trunk';
  }

  portsInVlan(vlan: number): string[] {
    return SWITCH_PORTS.filter((p) => {
      const cfg = this.ifaces.get(p);
      return cfg !== undefined && (this.isTrunk(p) || cfg.accessVlan === vlan);
    });
  }

  onIfaceChanged(name: string, before: IfaceConfig | undefined): void {
    const after = this.ifaces.get(name);
    if (before && after && before.shutdown !== after.shutdown && after.switchport) {
      const up = !after.shutdown && this.hooks.peerUp(name);
      if (after.shutdown) this.log(`%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`);
      else if (up) this.log(`%LINK-5-CHANGED: Interface ${name}, changed state to up`);
      if (up || this.hooks.peerUp(name)) this.log(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to ${up ? 'up' : 'down'}`);
      this.hooks.portChanged(name);
    }
    if (after?.switchport) this.flushPort(name);
    this.stpChanged();
    this.syncSvis();
  }

  /** Something spanning tree depends on changed (ports, VLANs, priorities). */
  stpChanged(): void {
    this.hooks.stpChanged?.();
  }

  // ------------------------------------------------------------ spanning tree

  stpBridge(): StpBridge {
    const all = [...this.vlans.keys()].filter((v) => v === 1 || !DEFAULT_VLANS.has(v));
    const ports = SWITCH_PORTS.flatMap((name, i) => {
      const cfg = this.ifaces.get(name);
      if (!cfg || !this.portUp(name)) return [];
      const vlans = this.isTrunk(name) ? all : this.vlans.has(cfg.accessVlan) ? [cfg.accessVlan] : [];
      return [{ name, number: i + 1, cost: this.stp.cost(name), priority: this.stp.portPriority(name), edge: this.stp.portfast.has(name), vlans }];
    });
    return { id: this.id, mac: this.baseMac, priority: (v) => this.stp.priority(v), ports };
  }

  /**
   * The current spanning tree. When it changes, the VLANs whose forwarding ports changed anywhere lose their MAC
   * entries, as every switch does on a topology change notification.
   */
  syncStp(): StpResult | undefined {
    const tree = this.hooks.stp?.();
    if (!tree || tree === this.stpSeen?.tree) return tree;
    const keys = forwardingKeys(tree);
    const old = this.stpSeen?.keys;
    if (old) for (const [k, e] of this.macTable) if (keys.get(e.vlan) !== old.get(e.vlan)) this.macTable.delete(k);
    this.stpSeen = { tree, keys };
    return tree;
  }

  /** This switch's spanning tree for a VLAN (undefined when it does not run there). */
  stpVlan(vlan: number): StpVlan | undefined {
    return this.syncStp()?.get(this.id)?.get(vlan);
  }

  /** A port that blocks in this VLAN neither learns nor forwards. */
  private forwards(port: string, vlan: number): boolean {
    return this.stpVlan(vlan)?.ports.get(port)?.forwarding ?? true;
  }

  /** The cable end shows amber: the port blocks in every VLAN it carries. */
  portBlocked(port: string): boolean {
    const tree = this.syncStp()?.get(this.id);
    const states = tree ? [...tree.values()].map((s) => s.ports.get(port)).filter((p) => p !== undefined) : [];
    return states.length > 0 && states.every((p) => !p.forwarding);
  }

  onLinkEvent(port: string, up: boolean): void {
    if (!this.portAdminUp(port)) return;
    const state = up ? 'up' : 'down';
    this.log(`%LINK-5-CHANGED: Interface ${port}, changed state to ${state}`);
    this.log(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to ${state}`);
    if (!up) this.flushPort(port);
    this.syncSvis();
  }

  private flushPort(port: string): void {
    for (const [key, e] of this.macTable) if (e.port === port) this.macTable.delete(key);
  }

  // ------------------------------------------------------------ NetDevice

  portNames(): readonly string[] {
    return SWITCH_PORTS;
  }

  portAdminUp(port: string): boolean {
    return this.ifaces.get(port)?.shutdown === false;
  }

  ownsIp(ip: number): boolean {
    return this.l3Ifaces().some((i) => i.addrs.some((a) => a.ip === ip));
  }

  receive(port: string, frame: HopFrame): void {
    const cfg = this.ifaces.get(port);
    if (!cfg || cfg.shutdown || (frame.l2hops ?? 0) > MAX_L2_HOPS) return;
    const trunk = this.isTrunk(port);
    if (!trunk && frame.vlan !== undefined) return;
    const vlan = trunk ? (frame.vlan ?? cfg.nativeVlan) : cfg.accessVlan;
    if (!this.forwards(port, vlan)) return;
    this.macTable.set(`${vlan}|${frame.src}`, { mac: frame.src, vlan, port });
    const inspected = this.snooping.inspect(this, port, vlan, frame);
    if (!inspected) return;
    this.toSvi(vlan, inspected);
    this.switchFrame(vlan, { ...inspected, vlan: undefined, l2hops: (frame.l2hops ?? 0) + 1 }, port);
  }

  private switchFrame(vlan: number, frame: HopFrame, ingress: string | undefined): void {
    const known = frame.dst !== BROADCAST_MAC ? this.macTable.get(`${vlan}|${frame.dst}`) : undefined;
    if (known && known.port === ingress) return;
    if (frame.dst === this.baseMac) return;
    const out = known ? [known.port] : this.portsInVlan(vlan).filter((p) => p !== ingress);
    for (const p of out) {
      if (!this.portUp(p) || !this.forwards(p, vlan)) continue;
      const native = this.ifaces.get(p)?.nativeVlan ?? 1;
      const tagged = this.isTrunk(p) && vlan !== native;
      this.hooks.transmit(p, tagged ? { ...frame, vlan } : frame);
    }
  }

  // ------------------------------------------------------------ SVI (management IP)

  private sviName(vlan: number): string {
    return `Vlan${vlan}`;
  }

  private toSvi(vlan: number, frame: Frame): void {
    const svi = this.sviName(vlan);
    if (!this.ifaces.has(svi)) return;
    if (frame.dst === this.baseMac || frame.dst === BROADCAST_MAC) this.stack.receiveFrame(svi, frame);
  }

  private sviAddrs(name: string): IpWithPrefix[] {
    const cfg = this.ifaces.get(name);
    if (!cfg || cfg.switchport) return [];
    const lease = this.leases.get(name);
    if (cfg.dhcpClient) return lease ? [{ ip: lease.ip, prefix: lease.prefix }] : [];
    return cfg.address ? [cfg.address] : [];
  }

  dhcpLearned(name: string): { ip: number; prefix: number } | undefined {
    const lease = this.leases.get(name);
    return lease ? { ip: lease.ip, prefix: lease.prefix } : undefined;
  }

  l3Iface(name: string): L3Iface | undefined {
    const cfg = this.ifaces.get(name);
    if (!cfg || cfg.switchport) return undefined;
    return { name, mac: this.baseMac, addrs: this.sviAddrs(name), up: this.ifaceRuntime(name).protocolUp };
  }

  l3Ifaces(): readonly L3Iface[] {
    return this.sortedIfaceNames().map((n) => this.l3Iface(n)).filter((i): i is L3Iface => i !== undefined);
  }

  emit(iface: string, frame: Frame): void {
    const vlan = Number(parseIfaceName(iface)?.number ?? 1);
    this.switchFrame(vlan, frame, undefined);
  }

  schedule(delayMs: number, fn: () => void): void {
    this.hooks.schedule(delayMs, fn);
  }

  route(dst: number): Egress | null {
    for (const i of this.l3Ifaces()) {
      if (i.up && i.addrs.some((a) => inSubnet(dst, a.ip, a.prefix))) return { iface: i.name, nextHop: dst };
    }
    const gw = this.defaultGateway ?? [...this.leases.values()][0]?.routers[0];
    if (gw === undefined) return null;
    const via = this.l3Ifaces().find((i) => i.up && i.addrs.some((a) => inSubnet(gw, a.ip, a.prefix)));
    return via ? { iface: via.name, nextHop: gw } : null;
  }

  deliver(iface: string, packet: IpPacket): void {
    if (packet.tcp) {
      this.web.tcp.receive(packet);
      return;
    }
    const dhcp = packet.udp?.dhcp;
    if (dhcp && packet.udp?.dport === DHCP_CLIENT_PORT) this.clients.get(iface)?.receive(dhcp);
  }

  syncSvis(): void {
    for (const name of this.sortedIfaceNames()) {
      const cfg = this.ifaces.get(name);
      if (!cfg || cfg.switchport) continue;
      const wanted = cfg.dhcpClient !== undefined && this.ifaceRuntime(name).protocolUp;
      const existing = this.clients.get(name);
      if (!wanted) {
        existing?.stop();
        this.clients.delete(name);
        this.leases.delete(name);
      } else if (!existing || existing.state === 'STOPPED') {
        const client = this.newClient(name);
        this.clients.set(name, client);
        client.start();
      }
    }
  }

  private newClient(name: string): DhcpClient {
    const short = shortIfaceName(name).replace('Vlan', 'Vl');
    return new DhcpClient({
      mac: this.baseMac,
      clientId: `00${asciiToHex(`cisco-${formatMacCisco(this.baseMac)}-${short}`)}`,
      hostname: this.ifaces.get(name)?.dhcpClient?.hostname ?? this.hostname,
      send: (msg, dst, src) => {
        const packet: IpPacket = { src, dst, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_CLIENT_PORT, dport: DHCP_SERVER_PORT, dhcp: msg } };
        if (dst === BROADCAST_IP) this.stack.broadcast(name, packet);
        else this.stack.send(packet);
      },
      schedule: (d, fn) => this.schedule(d, fn),
      now: () => this.clock.now(),
      onBound: (lease) => {
        this.leases.set(name, lease);
        this.log(`%DHCP-6-ADDRESS_ASSIGN: Interface ${name} assigned DHCP address ${formatIp(lease.ip)}, mask ${formatMask(lease.prefix)}, hostname ${this.hostname}`);
      },
      onFailed: () => undefined,
      onLost: () => { this.leases.delete(name); },
    });
  }

  // ------------------------------------------------------------ config

  runningConfig(): string[] {
    const vlanLines = [...this.vlans.entries()]
      .filter(([id]) => !DEFAULT_VLANS.has(id))
      .flatMap(([id, name]) => [`vlan ${id}`, ...(name !== `VLAN${String(id).padStart(4, '0')}` ? [` name ${name}`] : []), '!']);
    return [
      ...headerLines(this, '15.0'),
      ...globalIpLines(this),
      ...this.snooping.configLines(),
      ...this.stp.configLines(),
      '!',
      ...vlanLines,
      ...interfaceSection(this, (n) => [...this.stp.ifaceLines(n), ...this.snooping.ifaceLines(n)]),
      ...(this.defaultGateway !== undefined ? [`ip default-gateway ${formatIp(this.defaultGateway)}`] : []),
      ...httpLines(this),
      '!',
      ...trailerLines(this),
    ];
  }
}
