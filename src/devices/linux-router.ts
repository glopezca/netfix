/**
 * Linux router: the hardware of a Cisco 2911 (GigabitEthernet0/0-2) running the software of Server
 * (Ubuntu: bash, systemd units, sshd, web admin) as eth0-2. It forwards between its NICs only when
 * net.ipv4.ip_forward = 1; the nftables forward chain, conntrack and NAT apply to transit traffic.
 */
import { Server } from './server.ts';
import type { HostOs } from './host.ts';
import type { NicInfo } from './host-nics.ts';
import type { Frame, IpPacket } from '../net/packets.ts';
import type { L3Iface } from '../net/ipstack.ts';
import type { SimClock } from '../core/clock.ts';

export const LINUX_ROUTER_PORTS = ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2'] as const;
const LINUX_TTL = 64;

interface Nic {
  ip?: number;
  prefix?: number;
  adminUp: boolean;
  readonly mac: string;
}

/** MAC of the n-th NIC: the base MAC plus n (like consecutive ports of one card). */
function macPlus(mac: string, n: number): string {
  return ((parseInt(mac, 16) + n) % 0x1000000000000).toString(16).padStart(12, '0');
}

export class LinuxRouter extends Server {
  override readonly kind = 'linuxrouter' as const;
  override os: HostOs = 'linux';
  override readonly ttl = LINUX_TTL;
  /** NICs 1 and 2 (NIC 0 is the host's main configuration: `config`, DHCP client, `portUp`). */
  private readonly extra = new Map<string, Nic>();

  constructor(id: string, name: string, clock: SimClock, seed: number) {
    super(id, name, clock, seed);
    LINUX_ROUTER_PORTS.slice(1).forEach((p, i) => this.extra.set(p, { adminUp: true, mac: macPlus(this.mac, i + 1) }));
  }

  override primaryPort(): string {
    return LINUX_ROUTER_PORTS[0];
  }

  override portNames(): readonly string[] {
    return LINUX_ROUTER_PORTS;
  }

  override linuxIfName(port: string): string {
    const i = (LINUX_ROUTER_PORTS as readonly string[]).indexOf(port);
    return i >= 0 ? `eth${i}` : port;
  }

  override ifaceConfig(port: string): { readonly ip?: number; readonly prefix?: number } | undefined {
    return port === this.primaryPort() ? this.config : this.extra.get(port);
  }

  override portAdminUp(port?: string): boolean {
    return port === undefined || port === this.primaryPort() ? this.portUp : this.extra.get(port)?.adminUp ?? false;
  }

  private portLinkUp(port: string): boolean {
    return this.portAdminUp(port) && this.hooks.peerUp(port);
  }

  override nics(): NicInfo[] {
    return LINUX_ROUTER_PORTS.map((port, i) => {
      const cfg = this.ifaceConfig(port) ?? {};
      const mac = i === 0 ? this.mac : this.extra.get(port)?.mac ?? this.mac;
      return { port, linux: `eth${i}`, mac, up: this.portLinkUp(port), adminUp: this.portAdminUp(port), ip: cfg.ip, prefix: cfg.prefix, dhcp: i === 0 && this.config.mode === 'dhcp' };
    });
  }

  override setNicAddress(port: string, addr: { readonly ip: number; readonly prefix: number } | undefined): void {
    const nic = this.extra.get(port);
    if (!nic) {
      super.setNicAddress(port, addr);
      return;
    }
    nic.ip = addr?.ip;
    nic.prefix = addr?.prefix;
    this.stack.flushArp(port);
    this.changed();
  }

  override setNicUp(port: string, up: boolean): void {
    const nic = this.extra.get(port);
    if (!nic) {
      super.setNicUp(port, up);
      return;
    }
    if (nic.adminUp === up) return;
    nic.adminUp = up;
    this.hooks.portChanged(port);
    this.changed();
  }

  override receive(port: string, frame: Frame): void {
    this.stack.receiveFrame(port, frame);
  }

  override emit(iface: string, frame: Frame): void {
    this.hooks.transmit(iface, frame);
  }

  override l3Iface(name: string): L3Iface | undefined {
    return this.l3Ifaces().find((i) => i.name === name);
  }

  override l3Ifaces(): readonly L3Iface[] {
    return this.nics().map((n) => ({ name: n.port, mac: n.mac, addrs: n.ip !== undefined && n.prefix !== undefined ? [{ ip: n.ip, prefix: n.prefix }] : [], up: n.up }));
  }

  override ownsIp(ip: number): boolean {
    return this.nics().some((n) => n.ip === ip);
  }

  override onLinkEvent(port: string, up: boolean): void {
    if (port === this.primaryPort()) super.onLinkEvent(port, up);
    else this.changed();
  }

  /** Transit packets: ip_forward, TTL, route, nftables forward chain, then out (postrouting does NAT). */
  forward(iface: string, packet: IpPacket): void {
    if (!this.kernel.sysctl.enabled('net.ipv4.ip_forward')) return;
    if (packet.ttl <= 1) {
      this.icmpError(iface, packet, 'ttl-exceeded');
      return;
    }
    const egress = this.route(packet.dst);
    if (!egress) {
      this.icmpError(iface, packet, 'unreachable');
      return;
    }
    const nf = this.kernel.netfilter;
    const allowed = nf.forward(this.linuxIfName(iface), this.linuxIfName(egress.iface), packet);
    if (!allowed) return;
    this.stack.sendVia(egress, nf.carry(allowed, { ...allowed, ttl: allowed.ttl - 1 }));
  }

  /** ICMP time exceeded / destination unreachable from the address of the arrival interface. */
  private icmpError(iface: string, p: IpPacket, type: 'ttl-exceeded' | 'unreachable'): void {
    const src = this.ifaceConfig(iface)?.ip;
    if (src === undefined || (p.icmp && p.icmp.type !== 'echo-request')) return;
    const back = this.route(p.src);
    if (!back) return;
    this.stack.sendVia(back, { src, dst: p.src, ttl: LINUX_TTL, protocol: 'icmp', icmp: { type, id: p.icmp?.id ?? 0, seq: p.icmp?.seq ?? 0 } });
  }
}
