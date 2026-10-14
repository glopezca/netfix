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
import { rewriteDst, rewriteSrc } from './nat.ts';
import { formatIp } from '../core/ip.ts';

export interface NetfilterEnv {
  now(): number;
  /** Kernel log line (`log` statement): dmesg / journalctl -k. */
  log(line: string): void;
  /** Primary IPv4 address of a Linux interface (masquerade). */
  ifaceIp(name: string): number | undefined;
  /** Sends the TCP RST or ICMP error of a `reject`. */
  reject(p: IpPacket, kind: string | undefined): void;
}

interface Ctx {
  readonly entry: CtEntry | null;
  readonly dir: Direction;
  readonly state: CtState;
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

  private evalEnv(): EvalEnv {
    return {
      counters: this.counters,
      log: (prefix, p, meta) => {
        const l4 = p.tcp ?? p.udp;
        const ports = l4 ? ` SPT=${l4.sport} DPT=${l4.dport}` : '';
        this.env.log(`${prefix}IN=${meta.iif ?? ''} OUT=${meta.oif ?? ''} SRC=${formatIp(p.src)} DST=${formatIp(p.dst)} LEN=60 TTL=${p.ttl} PROTO=${p.protocol.toUpperCase()}${ports}`);
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
    const r = filterHook(this.ruleset, hook, p, meta, this.evalEnv());
    if (r.verdict === 'reject') this.env.reject(p, r.with);
    return r.verdict === 'accept';
  }

  /** Incoming packet before routing: undo SNAT of replies, apply or decide DNAT, filter prerouting. */
  prerouting(iif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    let out = p;
    if (c.entry?.confirmed) {
      if (c.dir === 'orig' && c.entry.dnat) out = rewriteDst(p, c.entry.dnat.ip, c.entry.dnat.port);
      if (c.dir === 'reply' && c.entry.snat) out = rewriteDst(p, c.entry.orig.src, c.entry.orig.sport);
    } else if (c.entry && this.hooks.has('prerouting')) {
      const d = natHook(this.ruleset, 'prerouting', p, { iif, ct: c.state }, this.evalEnv());
      if (d === 'drop') return null;
      if (d?.kind === 'dnat') {
        c.entry.dnat = { ip: d.ip, port: d.port };
        out = rewriteDst(p, d.ip, d.port);
      }
    }
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
    return this.filter('forward', p, { iif, oif, ct: c.state }) ? this.keep(p, c) : null;
  }

  /** Locally generated packet: conntrack, DNAT of the output nat chain, filter output. */
  output(oif: string, p: IpPacket): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    let out = p;
    if (c.entry && !c.entry.confirmed && this.hooks.has('output')) {
      const d = natHook(this.ruleset, 'output', p, { oif, ct: c.state }, this.evalEnv());
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
  postrouting(oif: string, p: IpPacket, iif?: string): IpPacket | null {
    if (!this.active) return p;
    const c = this.context(p);
    let out = p;
    if (c.entry?.confirmed) {
      if (c.dir === 'orig' && c.entry.snat) out = rewriteSrc(p, c.entry.snat.ip, c.entry.snat.port);
      if (c.dir === 'reply' && c.entry.dnat) out = rewriteSrc(p, c.entry.orig.dst, c.entry.orig.dport);
    } else if (c.entry && this.hooks.has('postrouting')) {
      const d = natHook(this.ruleset, 'postrouting', p, { iif, oif, ct: c.state }, this.evalEnv());
      if (d === 'drop') return null;
      const to = d && d.kind !== 'dnat' ? this.snatTarget(p, d.kind === 'masquerade' ? this.env.ifaceIp(oif) : d.ip, d.kind === 'snat' ? d.port : undefined) : null;
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
