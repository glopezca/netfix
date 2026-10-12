/** Cisco IOS DHCP server: pools, exclusions, bindings, conflicts and statistics. */
import { inSubnet, formatIp, BROADCAST_IP } from '../core/ip.ts';
import { formatHexId, formatMacCisco } from '../core/mac.ts';
import type { DhcpMessage, DhcpOptions, DhcpType } from '../net/packets.ts';
import type { PoolConfig } from './pool.ts';
import { poolNetworks, usableRange, effectiveParams, leaseSeconds, INFINITE_LEASE, NETBIOS_NODE_TYPES, totalAddresses } from './pool.ts';
import { selectPool, findManualPool, findReservation } from './match.ts';
import type { ClientIdentity } from './match.ts';
import { RECEIVED, SENT, zeroCounters, bump } from './server-types.ts';
import type { Binding, Conflict, ExcludedRange, ServerContext, ServerReply, ReceivedCounter, SentCounter } from './server-types.ts';

export type { Binding, Conflict, ExcludedRange, ServerContext, ServerReply, ReceivedCounter, SentCounter };

const OFFER_HOLD_MS = 60_000;
const MS = 1000;

interface Offer {
  readonly ip: number;
  readonly pool: string;
  readonly manual: boolean;
  readonly expiresAt: number;
}

export class DhcpServer {
  serviceEnabled = true;
  pools: readonly PoolConfig[] = [];
  excluded: readonly ExcludedRange[] = [];
  conflictLogging = true;
  pingPackets = 2;
  pingTimeoutMs = 500;
  bootpIgnore = false;
  databases: readonly string[] = [];
  relayInfoOption = false;
  relayInfoTrustAll = false;
  relayInfoPolicy: string | undefined;
  smartRelay = false;
  useOptions: readonly string[] = [];
  debugEvents = false;
  debugPacket = false;

  private readonly bindings = new Map<number, Binding>();
  private readonly offers = new Map<string, Offer>();
  private readonly conflicts = new Map<number, Conflict>();
  private received = zeroCounters(RECEIVED);
  private sent = zeroCounters(SENT);
  private expiredCount = 0;
  private malformed = 0;

  // ------------------------------------------------------------ configuration

  pool(name: string): PoolConfig | undefined {
    return this.pools.find((p) => p.name === name);
  }

  savePool(pool: PoolConfig): void {
    const exists = this.pools.some((p) => p.name === pool.name);
    this.pools = exists ? this.pools.map((p) => (p.name === pool.name ? pool : p)) : [...this.pools, pool];
  }

  deletePool(name: string): boolean {
    if (!this.pool(name)) return false;
    this.pools = this.pools.filter((p) => p.name !== name);
    for (const [ip, b] of this.bindings) if (b.pool === name) this.bindings.delete(ip);
    return true;
  }

  isExcluded(ip: number): boolean {
    return this.excluded.some((r) => ip >= r.low && ip <= r.high);
  }

  // ------------------------------------------------------------ state queries

  /** Automatic bindings plus manual bindings declared by host pools. */
  allBindings(now: number): Binding[] {
    this.expire(now);
    const manual: Binding[] = this.pools.flatMap((p) => {
      if (!p.host || (!p.clientIdentifier && !p.hardwareAddress)) return [];
      return [{ ip: p.host.ip, pool: p.name, clientId: p.clientIdentifier, mac: p.hardwareAddress?.mac ?? '', type: 'Manual' as const, expiresAt: null, iface: '' }];
    });
    return [...this.bindings.values(), ...manual].sort((a, b) => a.ip - b.ip);
  }

  conflictList(): Conflict[] {
    return [...this.conflicts.values()].sort((a, b) => a.ip - b.ip);
  }

  stats(): { received: Readonly<Record<ReceivedCounter, number>>; sent: Readonly<Record<SentCounter, number>>; expired: number; malformed: number; automatic: number; manual: number } {
    const manual = this.pools.filter((p) => p.host && (p.clientIdentifier || p.hardwareAddress)).length;
    return { received: this.received, sent: this.sent, expired: this.expiredCount, malformed: this.malformed, automatic: this.bindings.size, manual };
  }

  leasedIn(pool: PoolConfig): number {
    return [...this.bindings.values()].filter((b) => b.pool === pool.name).length;
  }

  // ------------------------------------------------------------ clear commands

  clearBindings(ip?: number): boolean {
    if (ip === undefined) {
      this.bindings.clear();
      return true;
    }
    return this.bindings.delete(ip);
  }

  clearConflicts(ip?: number): boolean {
    if (ip === undefined) {
      this.conflicts.clear();
      return true;
    }
    return this.conflicts.delete(ip);
  }

  clearStatistics(): void {
    this.received = zeroCounters(RECEIVED);
    this.sent = zeroCounters(SENT);
    this.malformed = 0;
    this.expiredCount = 0;
  }

  expire(now: number): void {
    for (const [ip, b] of this.bindings) {
      if (b.expiresAt !== null && b.expiresAt <= now) {
        this.bindings.delete(ip);
        this.expiredCount++;
      }
    }
  }

  // ------------------------------------------------------------ protocol

  handle(msg: DhcpMessage, ctx: ServerContext): ServerReply | null {
    if (!this.serviceEnabled || msg.op !== 'BOOTREQUEST') return null;
    this.expire(ctx.now);
    const type = msg.options.messageType;
    if (msg.options.relayAgentInfo && msg.giaddr === 0 && !ctx.relayTrusted && !this.relayInfoTrustAll) {
      this.packetLog(ctx, 'DHCPD: inconsistent relay information.');
      this.packetLog(ctx, `DHCPD: relay information option exists, but giaddr is zero.`);
      return null;
    }
    this.received = bump(this.received, `DHCP${type}` as ReceivedCounter);
    const client = identity(msg);
    this.packetLog(ctx, `DHCPD: DHCP${type} received from client ${client.display}${msg.giaddr ? ` through relay ${formatIp(msg.giaddr)}` : ` on interface ${ctx.ifaceName}`}.`);
    switch (type) {
      case 'DISCOVER': return this.onDiscover(msg, client, ctx);
      case 'REQUEST': return this.onRequest(msg, client, ctx);
      case 'RELEASE': this.onRelease(msg, client, ctx); return null;
      case 'DECLINE': this.onDecline(msg, client, ctx); return null;
      case 'INFORM': return this.onInform(msg, client, ctx);
      default: this.malformed++; return null;
    }
  }

  /** A binding belongs to the client by client-id, or by MAC when its pool says so. */
  private boundTo(b: Binding, client: ClientIdentity): boolean {
    if (this.pool(b.pool)?.matchClientId === false) return b.mac === client.mac;
    return matchesBinding(b, client);
  }

  private subnetAddr(msg: DhcpMessage, ctx: ServerContext): number | undefined {
    return msg.giaddr || ctx.ifaceAddrs[0]?.ip;
  }

  private onDiscover(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): ServerReply | null {
    this.eventLog(ctx, ['DHCPD: Sending notification of DISCOVER:', `  DHCPD: htype 1 chaddr ${formatMacCisco(msg.chaddr)}`, '  DHCPD: circuit id 00000000']);
    const choice = this.choose(msg, client, ctx);
    if (!choice) return null;
    this.offers.set(client.key, { ...choice, expiresAt: ctx.now + OFFER_HOLD_MS });
    return this.reply('OFFER', msg, client, choice.ip, choice.pool, ctx);
  }

  /** Picks the address for a client: manual binding, reservation, existing lease, requested, free. */
  private choose(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): Omit<Offer, 'expiresAt'> | null {
    const subnet = this.subnetAddr(msg, ctx);
    if (subnet === undefined) return null;
    const manual = findManualPool(this.pools, client, subnet, ctx.ifaceAddrs, msg.giaddr !== 0);
    if (manual?.host) return { ip: manual.host.ip, pool: manual.name, manual: true };
    const pool = selectPool(this.pools, subnet);
    if (!pool) {
      this.eventLog(ctx, [`DHCPD: there is no pool for ${formatIp(subnet)}.`]);
      return null;
    }
    const ip = this.pickAddress(pool, client, msg.options.requestedIp, ctx);
    if (ip === null) {
      this.eventLog(ctx, [`DHCPD: no address available in pool ${pool.name}.`]);
      return null;
    }
    return { ip, pool: pool.name, manual: false };
  }

  private pickAddress(pool: PoolConfig, client: ClientIdentity, requested: number | undefined, ctx: ServerContext): number | null {
    const reserved = findReservation(pool, client);
    if (reserved) return reserved.ip;
    const existing = [...this.bindings.values()].find((b) => b.pool === pool.name && this.boundTo(b, client));
    if (existing) return existing.ip;
    const offered = this.offers.get(client.key);
    if (offered && offered.pool === pool.name && offered.expiresAt > ctx.now) return offered.ip;
    if (pool.reservedOnly) return null;
    if (requested !== undefined && this.isFree(pool, requested, client, ctx) && !this.conflictFound(requested, ctx)) return requested;
    for (const net of poolNetworks(pool)) {
      const { first, last } = usableRange(net);
      for (let ip = first; ip <= last; ip++) {
        const excluded = this.excluded.find((r) => ip >= r.low && ip <= r.high);
        if (excluded) {
          ip = excluded.high;
          continue;
        }
        if (!this.isFree(pool, ip, client, ctx)) continue;
        if (this.conflictFound(ip, ctx)) continue;
        return ip;
      }
    }
    return null;
  }

  private isFree(pool: PoolConfig, ip: number, client: ClientIdentity, ctx: ServerContext): boolean {
    if (!poolNetworks(pool).some((n) => inSubnet(ip, n.ip, n.prefix))) return false;
    if (!poolNetworks(pool).some((n) => { const r = usableRange(n); return ip >= r.first && ip <= r.last; })) return false;
    if (this.isExcluded(ip) || ctx.ownIps.includes(ip) || this.conflicts.has(ip)) return false;
    const bound = this.bindings.get(ip);
    if (bound && !this.boundTo(bound, client)) return false;
    if (this.pools.some((p) => p.host?.ip === ip)) return false;
    if (this.pools.some((p) => p.reservations.some((r) => r.ip === ip))) return false;
    const heldByOther = [...this.offers.entries()].some(([key, o]) => o.ip === ip && key !== client.key && o.expiresAt > ctx.now);
    return !heldByOther;
  }

  /** Ping-before-offer: an answering address is recorded as a conflict and skipped. */
  private conflictFound(ip: number, ctx: ServerContext): boolean {
    if (this.pingPackets === 0 || !ctx.ipInUse(ip)) return false;
    if (this.conflictLogging) this.conflicts.set(ip, { ip, method: 'Ping', detectedAt: ctx.now });
    ctx.log(`%DHCPD-4-PING_CONFLICT: DHCP address conflict:  server pinged ${formatIp(ip)}.`);
    return true;
  }

  private onRequest(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): ServerReply | null {
    const { serverId, requestedIp } = msg.options;
    const ownServerIds = ctx.ifaceAddrs.map((a) => a.ip);
    if (serverId !== undefined && !ownServerIds.includes(serverId) && msg.giaddr === 0) {
      this.offers.delete(client.key);
      return null;
    }
    const wanted = requestedIp ?? msg.ciaddr;
    const offer = this.offers.get(client.key);
    if (offer && offer.ip === wanted) return this.commit(msg, client, offer, ctx);
    const known = this.knownAddress(msg, client, ctx);
    if (known) {
      return known.ip === wanted ? this.commit(msg, client, known, ctx) : this.reply('NAK', msg, client, 0, known.pool, ctx);
    }
    const subnet = this.subnetAddr(msg, ctx);
    const pool = subnet === undefined ? undefined : selectPool(this.pools, subnet);
    if (pool && !pool.renewDenyUnknown && !pool.reservedOnly && this.isFree(pool, wanted, client, ctx)) {
      return this.commit(msg, client, { ip: wanted, pool: pool.name, manual: false }, ctx);
    }
    return this.reply('NAK', msg, client, 0, pool?.name, ctx);
  }

  /** Address already tied to this client: manual binding, reservation or current lease. */
  private knownAddress(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): Omit<Offer, 'expiresAt'> | null {
    const subnet = this.subnetAddr(msg, ctx);
    if (subnet === undefined) return null;
    const manual = findManualPool(this.pools, client, subnet, ctx.ifaceAddrs, msg.giaddr !== 0);
    if (manual?.host) return { ip: manual.host.ip, pool: manual.name, manual: true };
    const pool = selectPool(this.pools, subnet);
    if (!pool) return null;
    const reserved = findReservation(pool, client);
    if (reserved) return { ip: reserved.ip, pool: pool.name, manual: false };
    const bound = [...this.bindings.values()].find((b) => b.pool === pool.name && this.boundTo(b, client));
    return bound ? { ip: bound.ip, pool: pool.name, manual: false } : null;
  }

  private commit(msg: DhcpMessage, client: ClientIdentity, offer: Omit<Offer, 'expiresAt'>, ctx: ServerContext): ServerReply {
    this.offers.delete(client.key);
    const pool = this.pool(offer.pool);
    if (!offer.manual && pool) {
      const secs = leaseSeconds(effectiveParams(pool, this.pools).lease);
      const expiresAt = secs === INFINITE_LEASE ? null : ctx.now + secs * MS;
      for (const [ip, b] of this.bindings) if (this.boundTo(b, client) && ip !== offer.ip) this.bindings.delete(ip);
      this.bindings.set(offer.ip, { ip: offer.ip, pool: offer.pool, clientId: client.clientId, mac: msg.chaddr, type: 'Automatic', expiresAt, iface: ctx.ifaceName, hostname: msg.options.hostname });
      this.eventLog(ctx, ['DHCPD: Adding binding to radix tree (' + formatIp(offer.ip) + ')', 'DHCPD: Adding binding to hash tree', `DHCPD: assigned IP address ${formatIp(offer.ip)} to client ${client.display}.`]);
      this.checkUtilization(pool, ctx);
    }
    return this.reply('ACK', msg, client, offer.ip, offer.pool, ctx);
  }

  private onRelease(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): void {
    const b = this.bindings.get(msg.ciaddr);
    if (!b || !this.boundTo(b, client)) return;
    this.bindings.delete(msg.ciaddr);
    this.eventLog(ctx, [`DHCPD: returned ${formatIp(msg.ciaddr)} to address pool ${b.pool}.`]);
  }

  private onDecline(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): void {
    const ip = msg.options.requestedIp;
    if (ip === undefined) return;
    this.bindings.delete(ip);
    this.offers.delete(client.key);
    if (this.conflictLogging) this.conflicts.set(ip, { ip, method: 'Gratuitous ARP', detectedAt: ctx.now });
    this.eventLog(ctx, [`DHCPD: Declined address ${formatIp(ip)} by client ${client.display}.`]);
  }

  private onInform(msg: DhcpMessage, client: ClientIdentity, ctx: ServerContext): ServerReply | null {
    const pool = selectPool(this.pools, msg.ciaddr);
    return pool ? this.reply('ACK', msg, client, 0, pool.name, ctx) : null;
  }

  private checkUtilization(pool: PoolConfig, ctx: ServerContext): void {
    const high = pool.utilizationHigh;
    if (!high?.log) return;
    const total = totalAddresses(pool);
    const used = this.leasedIn(pool);
    if (total > 0 && (used * 100) / total >= high.percent) {
      ctx.log(`%DHCPD-6-HIGH_UTIL: Pool ${pool.name} is in high utilization state (${used} addresses used out of ${total}). Threshold set at ${high.percent}%.`);
    }
  }

  // ------------------------------------------------------------ replies

  private reply(type: DhcpType, req: DhcpMessage, client: ClientIdentity, yiaddr: number, poolName: string | undefined, ctx: ServerContext): ServerReply {
    const pool = poolName ? this.pool(poolName) : undefined;
    const serverId = req.giaddr ? (ctx.ifaceAddrs[0]?.ip ?? 0) : (ctx.ifaceAddrs.find((a) => inSubnet(yiaddr || req.ciaddr, a.ip, a.prefix))?.ip ?? ctx.ifaceAddrs[0]?.ip ?? 0);
    const options = type === 'NAK' ? { messageType: type, serverId } : this.replyOptions(type, pool, yiaddr, serverId, req);
    const params = pool ? effectiveParams(pool, this.pools) : undefined;
    const msg: DhcpMessage = {
      op: 'BOOTREPLY', xid: req.xid, ciaddr: req.ciaddr, yiaddr: type === 'NAK' ? 0 : yiaddr,
      siaddr: params?.nextServers[0] ?? 0, giaddr: req.giaddr, chaddr: req.chaddr, broadcastFlag: req.broadcastFlag,
      file: params?.bootfile, options,
    };
    this.sent = bump(this.sent, `DHCP${type}` as SentCounter);
    this.sent = bump(this.sent, 'BOOTREPLY');
    const shown = yiaddr ? ` (${formatIp(yiaddr)})` : '';
    this.packetLog(ctx, `DHCPD: Sending DHCP${type} to client ${client.display}${shown}.`);
    const via = req.giaddr ? 'relay' : req.ciaddr && type === 'ACK' ? 'unicast' : 'broadcast';
    this.packetLog(ctx, via === 'relay'
      ? `DHCPD: unicasting BOOTREPLY for client ${formatMacCisco(req.chaddr)} to relay ${formatIp(req.giaddr)}.`
      : `DHCPD: ${via === 'unicast' ? 'unicasting' : 'broadcasting'} BOOTREPLY to client ${formatMacCisco(req.chaddr)}.`);
    return { msg, via };
  }

  private replyOptions(type: DhcpType, pool: PoolConfig | undefined, yiaddr: number, serverId: number, req: DhcpMessage): DhcpOptions {
    if (!pool) return { messageType: type, serverId };
    const p = effectiveParams(pool, this.pools);
    const prefix = pool.host?.prefix ?? poolNetworks(pool).find((n) => inSubnet(yiaddr || req.ciaddr, n.ip, n.prefix))?.prefix;
    const extra: Record<number, string> = {};
    let tftp: number[] | undefined;
    for (const o of p.options) {
      if (o.code === 150 && o.ips) tftp = [...o.ips];
      else extra[o.code] = o.kind === 'ip' ? (o.ips ?? []).map(formatIp).join(' ') : o.value;
    }
    return {
      messageType: type,
      serverId,
      leaseSeconds: type === 'INFORM' ? undefined : leaseSeconds(p.lease),
      subnetPrefix: prefix,
      routers: p.defaultRouters.length ? p.defaultRouters : undefined,
      dnsServers: p.dnsServers.length ? p.dnsServers : undefined,
      domainName: p.domainName,
      netbiosServers: p.netbiosServers.length ? p.netbiosServers : undefined,
      netbiosNodeType: p.netbiosNodeType ? (NETBIOS_NODE_TYPES[p.netbiosNodeType] ?? parseInt(p.netbiosNodeType, 16)) : undefined,
      tftpServers: tftp,
      extra: Object.keys(extra).length ? extra : undefined,
      hostname: pool.clientName,
    };
  }

  private packetLog(ctx: ServerContext, line: string): void {
    if (this.debugPacket) ctx.log(line);
  }

  private eventLog(ctx: ServerContext, lines: readonly string[]): void {
    if (this.debugEvents) lines.forEach((l) => ctx.log(l));
  }
}

export function identity(msg: DhcpMessage): ClientIdentity {
  const clientId = msg.options.clientId;
  return {
    clientId,
    mac: msg.chaddr,
    key: clientId ? `id:${clientId}` : `hw:${msg.chaddr}`,
    display: clientId ? formatHexId(clientId) : formatMacCisco(msg.chaddr),
  };
}

function matchesBinding(b: Binding, client: ClientIdentity): boolean {
  if (b.clientId && client.clientId) return b.clientId === client.clientId;
  return b.mac === client.mac;
}

/** Destination IP for a server reply sent on the local segment. */
export function replyDestination(reply: ServerReply): number {
  if (reply.via === 'unicast') return reply.msg.ciaddr;
  return BROADCAST_IP;
}

