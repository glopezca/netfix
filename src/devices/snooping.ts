/** DHCP snooping for the switch: trusted ports, binding table, option 82 insertion. */
import type { Frame } from '../net/packets.ts';
import { formatIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';

export interface SnoopBinding {
  readonly mac: string;
  readonly ip: number;
  readonly leaseSeconds: number;
  readonly vlan: number;
  readonly port: string;
}

/** What snooping needs from the switch. */
export interface SnoopHost {
  readonly macTable: ReadonlyMap<string, { readonly port: string }>;
  log(line: string): void;
}

export class Snooping {
  enabled = false;
  vlans = new Set<number>();
  trusted = new Set<string>();
  rateLimits = new Map<string, number>();
  option82 = true;
  database: string | undefined;
  verifyMac = true;
  readonly bindings = new Map<string, SnoopBinding>();

  reset(): void {
    this.enabled = false;
    this.vlans = new Set();
    this.trusted = new Set();
    this.rateLimits = new Map();
    this.option82 = true;
    this.database = undefined;
    this.verifyMac = true;
    this.bindings.clear();
  }

  active(vlan: number): boolean {
    return this.enabled && this.vlans.has(vlan);
  }

  /**
   * Returns the frame to forward (possibly with option 82 added) or null to drop it.
   * Server messages (OFFER/ACK/NAK) are only accepted on trusted ports.
   */
  inspect(sw: SnoopHost, port: string, vlan: number, frame: Frame): Frame | null {
    const dhcp = frame.ip?.udp?.dhcp;
    if (!dhcp || !this.active(vlan)) return frame;
    const trusted = this.trusted.has(port);
    if (dhcp.op === 'BOOTREPLY') {
      if (!trusted) return null;
      this.learn(sw, vlan, dhcp.chaddr, dhcp.yiaddr, dhcp.options.messageType, dhcp.options.leaseSeconds ?? 0);
      return frame;
    }
    if (!trusted && dhcp.giaddr !== 0) return null;
    if (this.verifyMac && !trusted && frame.src !== dhcp.chaddr) return null;
    const type = dhcp.options.messageType;
    if (type === 'RELEASE' || type === 'DECLINE') this.bindings.delete(dhcp.chaddr);
    if (!this.option82 || trusted || dhcp.options.relayAgentInfo) return frame;
    const ip = frame.ip!;
    return { ...frame, ip: { ...ip, udp: { ...ip.udp!, dhcp: { ...dhcp, options: { ...dhcp.options, relayAgentInfo: true } } } } };
  }

  private learn(sw: SnoopHost, vlan: number, mac: string, ip: number, type: string, lease: number): void {
    if (type === 'NAK') {
      this.bindings.delete(mac);
      return;
    }
    if (type !== 'ACK' || ip === 0) return;
    const port = sw.macTable.get(`${vlan}|${mac}`)?.port;
    if (port) this.bindings.set(mac, { mac, ip, leaseSeconds: lease, vlan, port });
  }

  configLines(): string[] {
    if (!this.enabled && this.vlans.size === 0 && this.option82 && !this.database) return [];
    const lines: string[] = [];
    if (this.enabled) lines.push('ip dhcp snooping');
    if (this.vlans.size) lines.push(`ip dhcp snooping vlan ${compactList([...this.vlans])}`);
    if (!this.option82) lines.push('no ip dhcp snooping information option');
    if (this.database) lines.push(`ip dhcp snooping database ${this.database}`);
    if (!this.verifyMac) lines.push('no ip dhcp snooping verify mac-address');
    return [...lines, '!'];
  }

  ifaceLines(port: string): string[] {
    const lines: string[] = [];
    if (this.trusted.has(port)) lines.push(' ip dhcp snooping trust');
    const rate = this.rateLimits.get(port);
    if (rate !== undefined) lines.push(` ip dhcp snooping limit rate ${rate}`);
    return lines;
  }

  show(): string[] {
    const lines = [
      `Switch DHCP snooping is ${this.enabled ? 'enabled' : 'disabled'}`,
      'DHCP snooping is configured on following VLANs:',
      this.vlans.size ? compactList([...this.vlans]) : 'none',
      `Insertion of option 82 is ${this.option82 ? 'enabled' : 'disabled'}`,
      `Verification of hwaddr field is ${this.verifyMac ? 'enabled' : 'disabled'}`,
      'Interface                  Trusted    Rate limit (pps)',
      '-----------------------    -------    ----------------',
    ];
    const ports = new Set([...this.trusted, ...this.rateLimits.keys()]);
    for (const p of [...ports].sort()) {
      lines.push(`${p.padEnd(27)}${(this.trusted.has(p) ? 'yes' : 'no').padEnd(11)}${this.rateLimits.get(p) ?? 'unlimited'}`);
    }
    return lines;
  }

  showBindings(): string[] {
    const rows = [...this.bindings.values()];
    return [
      'MacAddress          IpAddress        Lease(sec)  Type           VLAN  Interface',
      '------------------  ---------------  ----------  -------------  ----  -----------------',
      ...rows.map((b) => `${formatMacCisco(b.mac).toUpperCase().padEnd(20)}${formatIp(b.ip).padEnd(17)}${String(b.leaseSeconds).padEnd(12)}dhcp-snooping  ${String(b.vlan).padEnd(6)}${b.port}`),
      `Total number of bindings: ${rows.length}`,
    ];
  }
}

export function compactList(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i]!;
    parts.push(end > start ? `${start}-${end}` : `${start}`);
  }
  return parts.join(',');
}

export function parseVlanList(text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > 4094 || b < a) return null;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return out;
}
