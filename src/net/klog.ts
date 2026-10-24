/**
 * The kernel line of an nftables `log` statement (nf_log_syslog), as dmesg shows it:
 * «PREFIX IN=eth2 OUT=eth1 MAC=… SRC=… DST=… LEN=84 TOS=0x00 PREC=0x00 TTL=63 ID=… DF PROTO=ICMP TYPE=8 CODE=0 ID=… SEQ=1».
 * The simulator carries no payload sizes: LEN uses the usual sizes of each kind of packet.
 */
import type { IpPacket, TcpFlag } from './packets.ts';
import { formatIp } from '../core/ip.ts';

/** Above this initial TTL the sender is Windows (128), below it Linux (64): ping size and the DF bit depend on it. */
const LINUX_MAX_TTL = 64;
const IP_HEADER = 20;
const ICMP_TYPES: Readonly<Record<string, number>> = { 'echo-reply': 0, unreachable: 3, 'echo-request': 8, 'ttl-exceeded': 11 };
const UNREACHABLE_CODES: Readonly<Record<string, number>> = { net: 0, host: 1, port: 3, admin: 13 };
/** Order in which the kernel prints the TCP flags. */
const TCP_FLAG_ORDER: readonly TcpFlag[] = ['ACK', 'PSH', 'RST', 'SYN', 'FIN'];
const TCP_WINDOW = 64240;

export interface KlogMeta {
  readonly iif?: string;
  readonly oif?: string;
  /** «dst:src:08:00» of the Ethernet frame the packet arrived in (only with IN=). */
  readonly mac?: string;
  /** IP identification. */
  readonly id: number;
}

const fromLinux = (p: IpPacket): boolean => p.ttl <= LINUX_MAX_TTL;

/** IP total length of the usual packet of each kind (ping: 56 data bytes on Linux, 32 on Windows). */
function ipLength(p: IpPacket): number {
  if (p.icmp) return p.icmp.type === 'echo-request' || p.icmp.type === 'echo-reply' ? (fromLinux(p) ? 84 : 60) : 56;
  if (p.tcp) return p.tcp.flags.includes('SYN') ? (fromLinux(p) ? 60 : 52) : 52;
  if (p.udp) return p.udp.dns ? 73 : 76;
  return IP_HEADER;
}

function l4(p: IpPacket): string {
  if (p.icmp) {
    const code = p.icmp.type === 'unreachable' ? UNREACHABLE_CODES[p.icmp.code ?? 'host'] ?? 1 : 0;
    const echo = p.icmp.type === 'echo-request' || p.icmp.type === 'echo-reply' ? ` ID=${p.icmp.id} SEQ=${p.icmp.seq}` : '';
    return `PROTO=ICMP TYPE=${ICMP_TYPES[p.icmp.type] ?? 0} CODE=${code}${echo}`;
  }
  if (p.tcp) {
    const flags = TCP_FLAG_ORDER.filter((f) => p.tcp?.flags.includes(f)).join(' ');
    return `PROTO=TCP SPT=${p.tcp.sport} DPT=${p.tcp.dport} WINDOW=${TCP_WINDOW} RES=0x00 ${flags}${flags ? ' ' : ''}URGP=0`;
  }
  if (p.udp) return `PROTO=UDP SPT=${p.udp.sport} DPT=${p.udp.dport} LEN=${ipLength(p) - IP_HEADER}`;
  return `PROTO=${p.protocol.toUpperCase()}`;
}

/** TCP and everything Linux sends go with Don't Fragment (path MTU discovery); Windows' ping and UDP do not. */
const dontFragment = (p: IpPacket): boolean => p.tcp !== undefined || fromLinux(p);

export function kernelLogLine(prefix: string, p: IpPacket, m: KlogMeta): string {
  const mac = m.iif !== undefined && m.mac ? ` MAC=${m.mac}` : '';
  const df = dontFragment(p) ? ' DF' : '';
  return `${prefix}IN=${m.iif ?? ''} OUT=${m.oif ?? ''}${mac} SRC=${formatIp(p.src)} DST=${formatIp(p.dst)} LEN=${ipLength(p)} TOS=0x00 PREC=0x00 TTL=${p.ttl} ID=${m.id}${df} ${l4(p)}`;
}

/** «dst:src:08:00» as the kernel prints the MAC header (MACs are 12 hex characters). */
export function macHeader(dst: string, src: string): string {
  const pairs = (hex: string): string => (hex.match(/../g) ?? []).join(':');
  return `${pairs(dst)}:${pairs(src)}:08:00`;
}
