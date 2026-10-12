/** Wire-level data structures exchanged between simulated devices. */
import type { EditSpec } from '../bash/types.ts';

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
  /** Option 82 present (inserted by a snooping switch or relay). */
  readonly relayAgentInfo?: boolean;
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
  readonly dns?: DnsMessage;
}

// ---------------------------------------------------------------- DNS

export type DnsType = 'A' | 'CNAME' | 'MX' | 'NS' | 'TXT' | 'PTR' | 'SOA';
export type DnsRcode = 'NOERROR' | 'NXDOMAIN' | 'SERVFAIL' | 'REFUSED';

export interface DnsAnswer {
  readonly name: string;
  readonly type: DnsType;
  readonly ttl: number;
  /** A: dotted IP; CNAME/NS/PTR: name; MX: exchange; TXT: text; SOA: mname rname serial… */
  readonly data: string;
  readonly priority?: number;
}

export interface DnsMessage {
  readonly id: number;
  readonly response: boolean;
  readonly qname: string;
  readonly qtype: DnsType;
  readonly rcode?: DnsRcode;
  readonly authoritative?: boolean;
  readonly answers?: readonly DnsAnswer[];
  readonly authority?: readonly DnsAnswer[];
}

// ---------------------------------------------------------------- TCP + applications

export type TcpFlag = 'SYN' | 'ACK' | 'PSH' | 'FIN' | 'RST';

export interface MailMessage {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly date: number;
  /** Relay hops so far (a mail-loop guard, like counting Received: headers). */
  readonly hops?: number;
}

/** Application data carried in a TCP segment (one request and one response per connection). */
export type AppPayload =
  | { readonly app: 'HTTP'; readonly kind: 'request'; readonly method: 'GET' | 'HEAD'; readonly host: string; readonly path: string }
  | { readonly app: 'HTTP'; readonly kind: 'response'; readonly status: number; readonly reason: string; readonly server: string; readonly contentType: string; readonly body: string }
  | { readonly app: 'SMTP'; readonly kind: 'request'; readonly helo: string; readonly mail: MailMessage }
  | { readonly app: 'SMTP' | 'POP3' | 'IMAP'; readonly kind: 'reply'; readonly code: string; readonly text: string; readonly messages?: readonly MailMessage[] }
  | { readonly app: 'POP3' | 'IMAP'; readonly kind: 'request'; readonly user: string; readonly password: string }
  | { readonly app: 'SSH'; readonly kind: 'auth'; readonly user: string; readonly password: string; readonly clientOs: string }
  | { readonly app: 'SSH'; readonly kind: 'command'; readonly session: string; readonly line: string }
  /** Ctrl+C / Ctrl+D typed in the remote terminal. */
  | { readonly app: 'SSH'; readonly kind: 'key'; readonly session: string; readonly key: 'int' | 'eof' }
  /** Remote editor: save the buffer, or close the editor (the remote command continues). */
  | { readonly app: 'SSH'; readonly kind: 'edit'; readonly session: string; readonly action: 'save' | 'close'; readonly path?: string; readonly content?: string }
  | { readonly app: 'SSH'; readonly kind: 'output'; readonly ok: boolean; readonly lines: readonly string[]; readonly session?: string; readonly prompt?: string; readonly closed?: boolean; readonly secret?: boolean;
    /** A remote program opened an editor (nano/vim): the client shows it full screen. */
    readonly edit?: EditSpec;
    /** Result of an edit/save request: null when written. */
    readonly saveError?: string | null;
    /** Exit status of the remote shell when the session closes. */
    readonly status?: number };

export interface TcpSegment {
  readonly sport: number;
  readonly dport: number;
  readonly flags: readonly TcpFlag[];
  readonly seq: number;
  readonly ack: number;
  readonly data?: AppPayload;
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
  readonly protocol: 'icmp' | 'udp' | 'tcp';
  readonly icmp?: IcmpMessage;
  readonly udp?: UdpDatagram;
  readonly tcp?: TcpSegment;
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
export const DNS_PORT = 53;
export const WELL_KNOWN_PORTS: Readonly<Record<number, string>> = {
  22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP',
};
export const DEFAULT_TTL = 255;
export const PC_TTL = 128;

/** Label used by the simulation event list: DHCP, DNS, ARP, ICMP, HTTP, SMTP, POP3, IMAP, SSH or TCP. */
export function frameProtocol(frame: Frame): string {
  if (frame.arp) return 'ARP';
  const ip = frame.ip;
  if (!ip) return 'Ethernet';
  if (ip.udp?.dhcp) return 'DHCP';
  if (ip.udp?.dns) return 'DNS';
  if (ip.icmp) return 'ICMP';
  if (ip.tcp) {
    if (ip.tcp.data) return ip.tcp.data.app;
    return 'TCP';
  }
  return 'IPv4';
}

/** Name of the application on a TCP connection, from its well-known port. */
export function tcpService(seg: TcpSegment): string {
  return WELL_KNOWN_PORTS[seg.dport] ?? WELL_KNOWN_PORTS[seg.sport] ?? 'TCP';
}
