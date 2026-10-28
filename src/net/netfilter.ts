/**
 * netfilter of one Linux host: the nftables ruleset, its counters and conntrack, applied at the hooks of
 * the IP stack. NAT is decided by the nat chains for the first packet of a connection and then applied
 * from conntrack (as the kernel does); filter chains see post-DNAT destinations and pre-SNAT sources.
 */
import type { IpPacket } from './packets.ts';
import type { Hook, Ruleset } from './nft/model.ts';
import { EMPTY_RULESET } from './nft/model.ts';
import type { Counter } from './nft/format.ts';
import type { CtState, EvalEnv, PacketMeta } from './nft/eval.ts';
import { activeHooks, filterHook, natHook } from './nft/eval.ts';
import { Conntrack, tupleOf } from './conntrack.ts';
import type { CtEntry, Direction, NatTo } from './conntrack.ts';
import { rewriteDst, rewriteSrc, unNatError } from './nat.ts';
import { formatIp } from '../core/ip.ts';
import { kernelLogLine, macHeader } from './klog.ts';

export interface NetfilterEnv {
  now(): number;
  /** Kernel log line (`log` statement): dmesg / journalctl -k. */
  log(line: string): void;
  /** Primary IPv4 address of a Linux interface (masquerade). */
  ifaceIp(name: string): number | undefined;
  /** Sends the TCP RST or ICMP error of a `reject`; `iif` is the arrival interface of a forwarded packet. */
  reject(p: IpPacket, kind: string | undefined, iif?: string): void;
}

interface Ctx {
  readonly entry: CtEntry | null;
  readonly dir: Direction;
  readonly state: CtState;
  /** Arrival interface of a transit packet (for iifname in postrouting). */
  readonly iif?: string;
}

const FIRST_NAT_PORT = 32768;
const LAST_NAT_PORT = 60999;

export class Netfilter {
  ruleset: Ruleset = EMPTY_RULESET;
  readonly counters = new Map<number, Counter>();
  readonly ct: Conntrack;
  private readonly env: NetfilterEnv;
  private readonly ctx = new WeakMap<IpPacket, Ctx>();
  private hooks: ReadonlySet<Hook> = new Set();
  /** Ethernet header of each arrived packet (MAC= of the log line). */
  private readonly macs = new WeakMap<IpPacket, string>();
  /** IP identification of the logged packets (a fixed walk: deterministic, no repeats nearby). */
  private ipId = 4242;

  constructor(env: NetfilterEnv) {
    this.env = env;
    this.ct = new Conntrack(() => env.now());
  }

  /** Replaces the ruleset (nft commands, nftables.service); counters of removed rules go away. */
  setRuleset(rs: Ruleset): void {
    this.ruleset = rs;
    this.hooks = activeHooks(rs);
    const live = new Set(rs.tables.flatMap((t) => t.chains.flatMap((c) => c.rules.map((r) => r.handle))));
    for (const h of this.counters.keys()) if (!live.has(h)) this.counters.delete(h);
  }

  /** Nothing to do when no base chain exists (the common case: no firewall). */
  get active(): boolean {
    return this.hooks.size > 0;
  }

  /** Keeps the conntrack context when a packet is copied (TTL decrement while forwarding). */
  carry(from: IpPacket, to: IpPacket): IpPacket {
    const c = this.ctx.get(from);
    if (c) this.ctx.set(to, c);
    return to;
  }

  private evalEnv(hook: Hook): EvalEnv {
    return {
      counters: this.counters,
      log: (prefix, p, meta) => {
        // The kernel lowers the TTL of a forwarded packet before the forward hook.
        const seen = hook === 'forward' ? { ...p, ttl: p.ttl - 1 } : p;
        this.ipId = (this.ipId * 7919 + 1) % 65536;
        this.env.log(kernelLogLine(prefix, seen, { iif: meta.iif, oif: meta.oif, mac: this.macs.get(p), id: this.ipId }));
      },
    };
  }

  private context(p: IpPacket): Ctx {
    const known = this.ctx.get(p);
    if (known) return known;
    const c = this.ct.classify(p);
    return { entry: c.entry, dir: c.dir, state: c.state };
  }

  private keep(p: IpPacket, c: Ctx): IpPacket {
    this.ctx.set(p, c);
    return p;
  }

  private filter(hook: Hook, p: IpPacket, meta: PacketMeta): boolean {
    if (!this.hooks.has(hook)) return true;
    const r = filterHook(this.ruleset, hook, p, meta, this.evalEnv(hook));
    if (r.verdict === 'reject') this.env.reject(p, r.with, hook === 'forward' ? meta.iif : undefined);
    return r.verdict === 'accept';
  }

  /** The Ethernet header a packet arrived in, for the MAC= of the kernel log. */
  noteFrame(p: IpPacket, dstMac: string, srcMac: string): void {
    this.macs.set(p, macHeader(dstMac, srcMac));
  }

  /** Incoming packet before routing: undo SNAT of replies, apply or decide DNAT, filter prerouting. */
  prerouting(iif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    let out = p;
    const quoted = c.state === 'related' ? this.ct.quoted(p) : null;
    if (quoted?.dir === 'orig' && quoted.entry.snat?.ip === p.icmp?.orig?.src) {
      // An ICMP error about a source-translated packet goes back to the inside host (RFC 5508), quoting it as sent.
      const o = quoted.entry.orig;
      out = unNatError(p, o.src, o.sport, { ip: o.dst, port: o.dport });
    } else if (c.entry?.confirmed) {
      if (c.dir === 'orig' && c.entry.dnat) out = rewriteDst(p, c.entry.dnat.ip, c.entry.dnat.port);
      if (c.dir === 'reply' && c.entry.snat) out = rewriteDst(p, c.entry.orig.src, c.entry.orig.sport);
    } else if (c.entry && this.hooks.has('prerouting')) {
      const d = natHook(this.ruleset, 'prerouting', p, { iif, ct: c.state }, this.evalEnv('prerouting'));
      if (d === 'drop') return null;
      if (d?.kind === 'dnat') {
        c.entry.dnat = { ip: d.ip, port: d.port };
        out = rewriteDst(p, d.ip, d.port);
      }
    }
    const mac = this.macs.get(p);
    if (mac && out !== p) this.macs.set(out, mac);
    if (!this.filter('prerouting', out, { iif, ct: c.state })) return null;
    return this.keep(out, c);
  }

  /** Packet for this host: filter input and confirm the connection. */
  input(iif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    if (!this.filter('input', p, { iif, ct: c.state })) return null;
    if (c.entry && !this.ct.see(c.entry, c.dir, p)) return null;
    return p;
  }

  /** Transit packet (router): filter forward. */
  forward(iif: string, oif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    return this.filter('forward', p, { iif, oif, ct: c.state }) ? this.keep(p, { ...c, iif }) : null;
  }

  /** Locally generated packet: conntrack, DNAT of the output nat chain, filter output. */
  output(oif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    let out = p;
    if (c.entry && !c.entry.confirmed && this.hooks.has('output')) {
      const d = natHook(this.ruleset, 'output', p, { oif, ct: c.state }, this.evalEnv('output'));
      if (d === 'drop') return null;
      if (d?.kind === 'dnat') {
        c.entry.dnat = { ip: d.ip, port: d.port };
        out = rewriteDst(p, d.ip, d.port);
      }
    }
    if (!this.filter('output', out, { oif, ct: c.state })) return null;
    return this.keep(out, c);
  }

  /** Leaving packet: apply or decide SNAT/masquerade, undo DNAT of replies, confirm. */
  postrouting(oif: string, p: IpPacket, arrival?: string): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    const iif = arrival ?? c.iif;
    let out = p;
    if (c.entry?.confirmed) {
      if (c.dir === 'orig' && c.entry.snat) out = rewriteSrc(p, c.entry.snat.ip, c.entry.snat.port);
      if (c.dir === 'reply' && c.entry.dnat) out = rewriteSrc(p, c.entry.orig.dst, c.entry.orig.dport);
    } else if (c.entry && this.hooks.has('postrouting')) {
      const d = natHook(this.ruleset, 'postrouting', p, { iif, oif, ct: c.state }, this.evalEnv('postrouting'));
      if (d === 'drop') return null;
      const to = d && d.kind !== 'dnat' ? this.snatTarget(p, d.kind === 'masquerade' ? this.env.ifaceIp(oif) : d.ip, d.kind === 'snat' ? d.port : undefined) : null;
      // No address on the interface or no free port: the kernel drops it rather than leak the private source.
      if (d && d.kind !== 'dnat' && !to) return null;
      if (to) {
        c.entry.snat = to;
        out = rewriteSrc(p, to.ip, to.port);
      }
    }
    if (!this.filter('postrouting', out, { iif, oif, ct: c.state })) return null;
    if (c.entry && !this.ct.see(c.entry, c.dir, p)) return null;
    return out;
  }

  /** Source after SNAT, keeping the port unless another connection already uses it (like the kernel). */
  private snatTarget(p: IpPacket, ip: number | undefined, port: number | undefined): NatTo | null {
    const t = tupleOf(p);
    if (ip === undefined || !t) return null;
    if (port !== undefined) return { ip, port };
    const free = (sport: number): boolean => !this.ct.replyTaken({ ...t, src: ip, sport, dport: t.proto === 'icmp' ? sport : t.dport });
    if (free(t.sport)) return { ip, port: t.sport };
    for (let n = FIRST_NAT_PORT; n <= LAST_NAT_PORT; n++) if (free(n)) return { ip, port: n };
    return null;
  }

  /** `systemctl stop nftables` / `nft flush ruleset`. */
  flush(): void {
    this.setRuleset(EMPTY_RULESET);
    this.counters.clear();
  }
}
