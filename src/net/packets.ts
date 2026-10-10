/** Wire-level data structures exchanged between simulated devices. */

export type DhcpType = 'DISCOVER' | 'OFFER' | 'REQUEST' | 'DECLINE' | 'ACK' | 'NAK' | 'RELEASE' | 'INFORM';

export interface DhcpOptions {
  readonly messageType: DhcpType;
  /** Option 61 as lowercase hex (e.g. "01" + MAC). */
  readonly clientId?: string;
  readonly hostname?: string;
  readonly requestedIp?: number;
  readonly serverId?: number;
  readonly leaseSeconds?: number;
  readonly subnetPrefix?: number;
  readonly routers?: readonly number[];
  readonly dnsServers?: readonly number[];
  readonly domainName?: string;
  readonly netbiosServers?: readonly number[];
  readonly netbiosNodeType?: number;
  readonly tftpServers?: readonly number[];
  /** Other options configured with `option <code> …`, rendered as text. */
  readonly extra?: Readonly<Record<number, string>>;
  readonly message?: string;
}

export interface DhcpMessage {
  readonly op: 'BOOTREQUEST' | 'BOOTREPLY';
  readonly xid: number;
  readonly ciaddr: number;
  readonly yiaddr: number;
  readonly siaddr: number;
  readonly giaddr: number;
  readonly chaddr: string;
  readonly broadcastFlag: boolean;
  readonly file?: string;
  readonly options: DhcpOptions;
}

export interface UdpDatagram {
  readonly sport: number;
  readonly dport: number;
  readonly dhcp?: DhcpMessage;
}

export type IcmpType = 'echo-request' | 'echo-reply' | 'unreachable' | 'ttl-exceeded';

export interface IcmpMessage {
  readonly type: IcmpType;
  readonly id: number;
  readonly seq: number;
}

export interface IpPacket {
  readonly src: number;
  readonly dst: number;
  readonly ttl: number;
  readonly protocol: 'icmp' | 'udp';
  readonly icmp?: IcmpMessage;
  readonly udp?: UdpDatagram;
}

export interface ArpMessage {
  readonly op: 'request' | 'reply';
  readonly senderMac: string;
  readonly senderIp: number;
  readonly targetMac: string;
  readonly targetIp: number;
}

export interface Frame {
  readonly src: string;
  readonly dst: string;
  /** 802.1Q tag; undefined = untagged. */
  readonly vlan?: number;
  readonly arp?: ArpMessage;
  readonly ip?: IpPacket;
}

export const DHCP_SERVER_PORT = 67;
export const DHCP_CLIENT_PORT = 68;
export const DEFAULT_TTL = 255;
export const PC_TTL = 128;

/** Short label used by the simulation event list ("DHCP", "ARP", "ICMP"). */
export function frameProtocol(frame: Frame): string {
  if (frame.arp) return 'ARP';
  if (frame.ip?.udp?.dhcp) return 'DHCP';
  if (frame.ip?.icmp) return 'ICMP';
  return frame.ip ? 'IPv4' : 'Ethernet';
}
