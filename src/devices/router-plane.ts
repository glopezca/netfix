/** Router data plane: L3 interfaces, forwarding, DHCP server/relay and DHCP clients. */
import type { Router } from './router.ts';
import type { Frame, IpPacket, DhcpMessage } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DEFAULT_TTL } from '../net/packets.ts';
import { IpStack } from '../net/ipstack.ts';
import type { L3Iface, StackHost, Egress } from '../net/ipstack.ts';
import { buildRoutingTable, resolveEgress } from '../net/routing.ts';
import type { Route, StaticRouteInput } from '../net/routing.ts';
import { effectiveAddress } from '../ios/commands/show-iface.ts';
import { isSubinterface, parentOf, shortIfaceName } from '../ios/interfaces.ts';
import type { IpWithPrefix } from '../core/ip.ts';
import { formatIp, formatMask, BROADCAST_IP } from '../core/ip.ts';
import { formatHexId, formatMacCisco, clientIdFromMac, asciiToHex } from '../core/mac.ts';
import { DhcpClient } from '../dhcp/client.ts';
import type { Lease } from '../dhcp/client.ts';
import { selectPool, findManualPool } from '../dhcp/match.ts';
import { identity } from '../dhcp/server.ts';
import { natAnswersArp, natForward, natPrerouting } from './router-nat.ts';
import { inboundAllowed, outboundAllowed } from './router-acl.ts';
import type { ServerReply } from '../dhcp/server.ts';

const DHCP_DEFAULT_ROUTE_AD = 254;

export class RouterPlane implements StackHost {
  readonly stack: IpStack;
  readonly dropOnArpMiss = true;
  readonly ttl = DEFAULT_TTL;
  private readonly router: Router;
  private readonly clients = new Map<string, DhcpClient>();
  readonly leases = new Map<string, Lease>();

  constructor(router: Router) {
    this.router = router;
    this.stack = new IpStack(this, () => router.clock.now());
  }

  // ------------------------------------------------------------ interfaces

  private addrsOf(name: string): IpWithPrefix[] {
    const cfg = this.router.iface(name);
    if (!cfg || cfg.switchport) return [];
    const primary = effectiveAddress(this.router, cfg);
    const first = primary.ip !== undefined && primary.prefix !== undefined ? [{ ip: primary.ip, prefix: primary.prefix }] : [];
    return [...first, ...cfg.secondaries];
  }

  l3Iface(name: string): L3Iface | undefined {
    const cfg = this.router.iface(name);
    if (!cfg) return undefined;
    return { name, mac: this.router.ifaceMac(name), addrs: this.addrsOf(name), up: this.router.ifaceRuntime(name).protocolUp };
  }

  l3Ifaces(): readonly L3Iface[] {
    return this.router.sortedIfaceNames().map((n) => this.l3Iface(n)).filter((i): i is L3Iface => i !== undefined);
  }

  allIps(): number[] {
    return this.l3Ifaces().flatMap((i) => i.addrs.map((a) => a.ip));
  }

  /** Maps an arriving frame to the logical interface (subinterface by 802.1Q tag). */
  logicalIface(port: string, frame: Frame): string | undefined {
    if (frame.vlan === undefined) return port;
    return this.router.sortedIfaceNames().find((n) => isSubinterface(n) && parentOf(n) === port && this.router.iface(n)?.encapsulationVlan === frame.vlan);
  }

  receive(port: string, frame: Frame): void {
    const logical = this.logicalIface(port, frame);
    if (logical) this.stack.receiveFrame(logical, frame);
  }

  emit(iface: string, frame: Frame): void {
    const vlan = isSubinterface(iface) ? this.router.iface(iface)?.encapsulationVlan : undefined;
    this.router.hooks.transmit(parentOf(iface), vlan === undefined ? frame : { ...frame, vlan });
  }

  schedule(delayMs: number, fn: () => void): void {
    this.router.hooks.schedule(delayMs, fn);
  }

  // ------------------------------------------------------------ routing

  dhcpRoutes(): StaticRouteInput[] {
    return [...this.leases.values()].flatMap((lease) =>
      lease.routers[0] !== undefined ? [{ network: 0, prefix: 0, nextHop: lease.routers[0], iface: undefined, distance: DHCP_DEFAULT_ROUTE_AD }] : []);
  }

  table(): Route[] {
    return buildRoutingTable(this.router, [...this.router.staticRoutes, ...this.dhcpRoutes()]);
  }

  route(dst: number): Egress | null {
    if (dst === BROADCAST_IP) return null;
    return resolveEgress(this.table(), dst);
  }

  forwardsDirectedBroadcast(iface: string): boolean {
    return this.router.iface(iface)?.directedBroadcast === true;
  }

  forward(inIface: string, packet: IpPacket): void {
    if (packet.dst === BROADCAST_IP) return;
    const src = this.l3Iface(inIface)?.addrs[0]?.ip ?? 0;
    if (packet.ttl <= 1) {
      this.icmpError(packet, src, 'ttl-exceeded');
      return;
    }
    const egress = this.route(packet.dst);
    if (!egress) {
      this.icmpError(packet, src, 'unreachable');
      return;
    }
    const out = natForward(this.router, inIface, egress.iface, { ...packet, ttl: packet.ttl - 1 });
    if (!out) return;
    if (!outboundAllowed(this.router, egress.iface, out)) {
      this.icmpError(packet, src, 'unreachable');
      return;
    }
    const sealed = this.router.ipsec.outbound(egress.iface, out);
    if (sealed) this.stack.sendVia(egress, sealed);
  }

  /** Locally generated traffic also goes through the crypto map of its egress interface. */
  output(iface: string, packet: IpPacket): IpPacket | null {
    return this.router.ipsec.outbound(iface, packet);
  }

  /** Inbound access list, IPsec decapsulation, then NAT outside → inside (IOS order). */
  prerouting(iface: string, packet: IpPacket): IpPacket | null {
    if (!inboundAllowed(this.router, iface, packet)) {
      this.icmpError(packet, this.l3Iface(iface)?.addrs[0]?.ip ?? 0, 'unreachable');
      return null;
    }
    const opened = this.router.ipsec.inbound(iface, packet);
    return opened ? natPrerouting(this.router, iface, opened) : null;
  }

  answersArp(iface: string, ip: number): boolean {
    return natAnswersArp(this.router, iface, ip);
  }

  private icmpError(packet: IpPacket, src: number, type: 'unreachable' | 'ttl-exceeded'): void {
    if (!packet.icmp || packet.icmp.type !== 'echo-request') return;
    this.stack.send({ src, dst: packet.src, ttl: this.ttl, protocol: 'icmp', icmp: { ...packet.icmp, type } });
  }

  // ------------------------------------------------------------ local delivery (DHCP)

  deliver(iface: string, packet: IpPacket): void {
    if (packet.tcp) {
      this.router.web.tcp.receive(packet);
      return;
    }
    if (packet.udp?.isakmp) {
      this.router.ipsec.onIsakmp(iface, packet);
      return;
    }
    const dhcp = packet.udp?.dhcp;
    if (!dhcp) return;
    if (packet.udp?.dport === DHCP_CLIENT_PORT && dhcp.op === 'BOOTREPLY') {
      this.clients.get(iface)?.receive(dhcp);
      return;
    }
    if (packet.udp?.dport !== DHCP_SERVER_PORT) return;
    if (dhcp.op === 'BOOTREPLY') this.relayReply(dhcp);
    else if (packet.dst === BROADCAST_IP) this.onClientBroadcast(iface, dhcp);
    else this.serve(iface, dhcp, packet.dst);
  }

  private dlog(line: string): void {
    if (this.router.dhcp.debugPacket) this.router.log(line);
  }

  private onClientBroadcast(iface: string, msg: DhcpMessage): void {
    const cfg = this.router.iface(iface);
    const primary = this.addrsOf(iface)[0];
    if (!cfg || !primary) return;
    const server = this.router.dhcp;
    const addrs = this.addrsOf(iface);
    const hasLocalPool = server.serviceEnabled
      && (selectPool(server.pools, primary.ip) !== undefined || findManualPool(server.pools, identity(msg), primary.ip, addrs, false) !== undefined);
    if (hasLocalPool || cfg.helpers.length === 0) {
      this.serve(iface, msg, undefined);
      return;
    }
    if (!server.serviceEnabled) return;
    const relayed: DhcpMessage = { ...msg, giaddr: msg.giaddr || primary.ip };
    this.dlog(`DHCPD: setting giaddr to ${formatIp(primary.ip)}.`);
    for (const helper of cfg.helpers) {
      this.dlog(`DHCPD: BOOTREQUEST from ${identity(msg).display} forwarded to ${formatIp(helper)}.`);
      this.stack.send({ src: primary.ip, dst: helper, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_SERVER_PORT, dport: DHCP_SERVER_PORT, dhcp: relayed } });
    }
  }

  private serve(iface: string, msg: DhcpMessage, unicastDst: number | undefined): void {
    const addrs = this.addrsOf(iface);
    const ifaceAddrs = unicastDst !== undefined ? [{ ip: unicastDst, prefix: addrs[0]?.prefix ?? 24 }, ...addrs] : addrs;
    const reply = this.router.dhcp.handle(msg, {
      ifaceName: iface,
      ifaceAddrs,
      ownIps: this.allIps(),
      now: this.router.clock.now(),
      ipInUse: (ip) => this.router.hooks.ipInUse(ip, this.router.id),
      log: (l) => this.router.log(l),
      relayTrusted: this.router.iface(iface)?.relayInfoTrusted ?? false,
    });
    if (reply) this.sendServerReply(iface, reply);
  }

  private sendServerReply(iface: string, reply: ServerReply): void {
    const src = reply.msg.options.serverId ?? this.addrsOf(iface)[0]?.ip ?? 0;
    if (reply.via === 'relay') {
      this.stack.send({ src, dst: reply.msg.giaddr, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_SERVER_PORT, dport: DHCP_SERVER_PORT, dhcp: reply.msg } });
      return;
    }
    const packet: IpPacket = { src, dst: BROADCAST_IP, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_SERVER_PORT, dport: DHCP_CLIENT_PORT, dhcp: reply.msg } };
    if (reply.via === 'unicast') this.stack.sendVia({ iface, nextHop: reply.msg.ciaddr }, { ...packet, dst: reply.msg.ciaddr });
    else this.stack.broadcast(iface, packet);
  }

  /** Relay agent: a server reply addressed to our giaddr goes back to the client segment. */
  private relayReply(msg: DhcpMessage): void {
    const iface = this.l3Ifaces().find((i) => i.addrs.some((a) => a.ip === msg.giaddr));
    if (!iface) return;
    this.dlog(`DHCPD: forwarding BOOTREPLY to client ${formatMacCisco(msg.chaddr)}.`);
    this.stack.broadcast(iface.name, { src: msg.giaddr, dst: BROADCAST_IP, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_SERVER_PORT, dport: DHCP_CLIENT_PORT, dhcp: msg } });
  }

  // ------------------------------------------------------------ DHCP client (ip address dhcp)

  clientIdFor(iface: string): string {
    const cfg = this.router.iface(iface);
    const cidIface = cfg?.dhcpClient?.clientIdIface;
    if (cidIface) return clientIdFromMac(this.router.ifaceMac(cidIface));
    return `00${asciiToHex(`cisco-${formatMacCisco(this.router.ifaceMac(iface))}-${shortIfaceName(iface).replace('Gig', 'Gi')}`)}`;
  }

  /** Starts, keeps or stops the DHCP client of an interface according to its config and state. */
  syncClient(iface: string): void {
    const cfg = this.router.iface(iface);
    const wanted = cfg?.dhcpClient !== undefined && this.router.ifaceRuntime(iface).protocolUp;
    const existing = this.clients.get(iface);
    if (!wanted) {
      if (existing) {
        existing.stop();
        this.clients.delete(iface);
        this.leases.delete(iface);
      }
      return;
    }
    if (existing && existing.state !== 'STOPPED') return;
    const client = this.newClient(iface);
    this.clients.set(iface, client);
    client.start();
  }

  client(iface: string): DhcpClient | undefined {
    return this.clients.get(iface);
  }

  private newClient(iface: string): DhcpClient {
    const cfg = this.router.iface(iface);
    return new DhcpClient({
      mac: this.router.ifaceMac(iface),
      clientId: this.clientIdFor(iface),
      hostname: cfg?.dhcpClient?.hostname ?? this.router.hostname,
      send: (msg, dst, src) => {
        const packet: IpPacket = { src, dst, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_CLIENT_PORT, dport: DHCP_SERVER_PORT, dhcp: msg } };
        if (dst === BROADCAST_IP) this.stack.broadcast(iface, packet);
        else this.stack.send(packet);
      },
      schedule: (d, fn) => this.schedule(d, fn),
      now: () => this.router.clock.now(),
      onBound: (lease) => {
        this.leases.set(iface, lease);
        const host = cfg?.dhcpClient?.hostname ?? this.router.hostname;
        this.router.log(`%DHCP-6-ADDRESS_ASSIGN: Interface ${iface} assigned DHCP address ${formatIp(lease.ip)}, mask ${formatMask(lease.prefix)}, hostname ${host}`);
      },
      onFailed: () => undefined,
      onLost: () => { this.leases.delete(iface); },
    });
  }

  clientIdText(iface: string): string {
    return formatHexId(this.clientIdFor(iface));
  }
}
