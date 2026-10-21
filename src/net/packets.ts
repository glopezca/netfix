/** Wire-level data structures exchanged between simulated devices. */
import type { EditSpec } from '../bash/types.ts';
import type { Frame as ScreenFrame, KeyInput } from '../editors/buffer.ts';

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
  /** IKE (UDP 500) between IPsec peers. */
  readonly isakmp?: IsakmpMessage;
  /** WireGuard message (UDP 51820 by default). */
  readonly wg?: WgMessage;
}

// ---------------------------------------------------------------- SFTP

/** SFTP requests (OpenSSH sftp-server), paths absolute or relative to the login directory. */
export type SftpOp =
  | { readonly op: 'realpath'; readonly path: string }
  | { readonly op: 'list'; readonly path: string }
  | { readonly op: 'stat'; readonly path: string }
  | { readonly op: 'read'; readonly path: string }
  | { readonly op: 'write'; readonly path: string; readonly data: string }
  | { readonly op: 'mkdir'; readonly path: string }
  | { readonly op: 'rmdir'; readonly path: string }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'rename'; readonly path: string; readonly to: string }
  | { readonly op: 'chmod'; readonly path: string; readonly mode: number };

export interface SftpEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'link' | 'other';
  readonly size: number;
  readonly mode: number;
  readonly mtime: number;
  readonly owner: string;
  readonly group: string;
}

export interface SftpResult {
  readonly status: 'ok' | 'no-such-file' | 'permission-denied' | 'failure';
  readonly message?: string;
  readonly path?: string;
  readonly entries?: readonly SftpEntry[];
  readonly entry?: SftpEntry;
  readonly data?: string;
}

// ---------------------------------------------------------------- VPN

/**
 * IKE main mode + quick mode, condensed to four messages. The pre-shared key never travels: each side
 * proves it with sha256(psk ‖ nonces ‖ role) (base64).
 */
export type IsakmpMessage =
  | { readonly kind: 'mm1'; readonly ispi: string; readonly policies: readonly IkeProposal[]; readonly nonce: string }
  | { readonly kind: 'mm2'; readonly ispi: string; readonly rspi: string; readonly policy: IkeProposal; readonly nonce: string; readonly auth: string }
  | { readonly kind: 'mm3'; readonly ispi: string; readonly rspi: string; readonly auth: string; readonly qm: QuickModeOffer }
  | { readonly kind: 'qm2'; readonly ispi: string; readonly spi: number; readonly transforms: readonly string[] }
  | { readonly kind: 'notify'; readonly ispi: string; readonly reason: 'no-proposal' | 'auth' | 'qm' };

export interface IkeProposal {
  readonly encryption: string;
  readonly hash: string;
  readonly auth: string;
  readonly group: number;
}

export interface QuickModeOffer {
  /** Proxy identities: the initiator's local and remote networks (from its crypto ACL). */
  readonly local: { readonly ip: number; readonly prefix: number };
  readonly remote: { readonly ip: number; readonly prefix: number };
  readonly transforms: readonly string[];
  /** SPI the initiator wants to receive with. */
  readonly spi: number;
}

/** ESP: the protected packet travels inside (the simulator does not encrypt the bytes). */
export interface EspPayload {
  readonly spi: number;
  readonly seq: number;
  readonly inner: IpPacket;
}

export type WgMessage =
  | { readonly kind: 'initiation'; readonly sender: number; readonly publicKey: string; readonly proof: string }
  | { readonly kind: 'response'; readonly sender: number; readonly receiver: number; readonly publicKey: string; readonly proof: string }
  | { readonly kind: 'data'; readonly receiver: number; readonly counter: number; readonly inner: IpPacket }
  | { readonly kind: 'keepalive'; readonly receiver: number; readonly counter: number };

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
  /** Recursion desired (queries) / echoed in answers. */
  readonly rd?: boolean;
  /** Recursion available (answers from a recursive server). */
  readonly ra?: boolean;
  readonly answers?: readonly DnsAnswer[];
  readonly authority?: readonly DnsAnswer[];
  /** Glue: addresses of the name servers named in a referral. */
  readonly additional?: readonly DnsAnswer[];
}

// ---------------------------------------------------------------- TCP + applications

export type TcpFlag = 'SYN' | 'ACK' | 'PSH' | 'FIN' | 'RST';

export type HttpMethod = 'GET' | 'HEAD' | 'POST';
export type HttpHeaders = Readonly<Record<string, string>>;

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
  | { readonly app: 'HTTP'; readonly kind: 'request'; readonly method: HttpMethod; readonly host: string; readonly path: string;
    /** Lower-case header names: cookie, authorization, content-type… */
    readonly headers?: HttpHeaders; readonly body?: string }
  | { readonly app: 'HTTP'; readonly kind: 'response'; readonly status: number; readonly reason: string; readonly server: string; readonly contentType: string; readonly body: string;
    /** Lower-case header names: location, set-cookie (one per line), www-authenticate… */
    readonly headers?: HttpHeaders }
  | { readonly app: 'SMTP'; readonly kind: 'request'; readonly helo: string; readonly mail: MailMessage }
  | { readonly app: 'SMTP' | 'POP3' | 'IMAP'; readonly kind: 'reply'; readonly code: string; readonly text: string; readonly messages?: readonly MailMessage[] }
  | { readonly app: 'POP3' | 'IMAP'; readonly kind: 'request'; readonly user: string; readonly password: string }
  | { readonly app: 'SSH'; readonly kind: 'auth'; readonly user: string; readonly password: string; readonly clientOs: string;
    /** none = handshake only (host key, methods, challenge); absent = password (older clients). */
    readonly method?: 'none' | 'password' | 'publickey';
    /** none: random nonce the server must sign with its host key. */
    readonly nonce?: string;
    /** password/publickey: the challenge received in the handshake (identifies the connection). */
    readonly challenge?: string;
    /** publickey: the public key line and its signature over the challenge, user and key. */
    readonly key?: string;
    readonly signature?: string;
    /** `sftp`/`scp`: open the sftp subsystem instead of a shell. */
    readonly subsystem?: 'sftp' }
  | { readonly app: 'SSH'; readonly kind: 'command'; readonly session: string; readonly line: string }
  /** One SFTP request on an sftp session. */
  | { readonly app: 'SSH'; readonly kind: 'sftp'; readonly session: string; readonly req: SftpOp }
  /** Ctrl+C / Ctrl+D typed in the remote terminal. */
  | { readonly app: 'SSH'; readonly kind: 'key'; readonly session: string; readonly key: 'int' | 'eof' }
  /** Remote editor: save the buffer, or close the editor (the remote command continues). */
  | { readonly app: 'SSH'; readonly kind: 'edit'; readonly session: string; readonly action: 'save' | 'close'; readonly path?: string; readonly content?: string }
  /** Full-screen remote program (mc): a key (or only a redraw) and the terminal size. */
  | { readonly app: 'SSH'; readonly kind: 'screen'; readonly session: string; readonly key?: KeyInput; readonly width: number; readonly height: number }
  | { readonly app: 'SSH'; readonly kind: 'output'; readonly ok: boolean; readonly lines: readonly string[]; readonly session?: string; readonly prompt?: string; readonly closed?: boolean; readonly secret?: boolean;
    /** Handshake: the server's host key (public line), the authentication methods it accepts and the challenge (base64). */
    /** sftp session: the answer to the request. */
    readonly sftp?: SftpResult;
    readonly hostKey?: string;
    readonly methods?: readonly string[];
    readonly challenge?: string;
    /** Handshake: signature of the client's nonce and the challenge with the host key. */
    readonly hostSignature?: string;
    /** A remote program opened an editor (nano/vim): the client shows it full screen. */
    readonly edit?: EditSpec;
    /** Result of an edit/save request: null when written. */
    readonly saveError?: string | null;
    /** Exit status of the remote shell when the session closes. */
    readonly status?: number;
    /** Frame of the remote full-screen program, while one runs. */
    readonly screen?: ScreenFrame };

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
  readonly protocol: 'icmp' | 'udp' | 'tcp' | 'esp';
  readonly icmp?: IcmpMessage;
  readonly udp?: UdpDatagram;
  readonly tcp?: TcpSegment;
  readonly esp?: EspPayload;
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
  if (ip.udp?.isakmp) return 'ISAKMP';
  if (ip.udp?.wg) return 'WireGuard';
  if (ip.esp) return 'ESP';
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
