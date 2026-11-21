/**
 * dhcrelay on a GNU/Linux router or server (isc-dhcp-relay, S26): a client's BOOTREQUEST arriving on a served interface
 * goes to each server with that interface's address as giaddr; the server's BOOTREPLY to that giaddr goes back to the
 * clients of the interface. Kea on the same host still sees the request, as on Ubuntu.
 */
import type { Server } from './server.ts';
import type { DhcpMessage } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT } from '../net/packets.ts';
import { BROADCAST_IP, formatIp } from '../core/ip.ts';

/** dhcrelay's default maximum hop count (-c). */
const MAX_HOPS = 10;

/** aa:bb:cc:dd:ee:ff, as dhcrelay logs a client. */
const hw = (mac: string): string => (mac.match(/../g) ?? []).join(':');

/** True when the message was a reply for one of the relay's interfaces (nothing else is to be done with it). */
export function relayDhcp(server: Server, msg: DhcpMessage, arrived: string): boolean {
  const r = server.services.relay;
  if (!r.enabled || r.servers.length === 0) return false;
  const served = (port: string): boolean => r.interfaces.length === 0 || r.interfaces.includes(server.linuxIfName(port));
  if (msg.op === 'BOOTREPLY') {
    const out = server.portNames().find((p) => server.ifaceConfig(p)?.ip === msg.giaddr);
    if (out === undefined || !served(out)) return false;
    server.log('relay', `Forwarded BOOTREPLY for ${hw(msg.chaddr)} to ${formatIp(msg.yiaddr)}`);
    server.sendUdp(BROADCAST_IP, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, { dhcp: msg }, msg.giaddr, out);
    return true;
  }
  const own = served(arrived) ? server.ifaceConfig(arrived)?.ip : undefined;
  if (own === undefined) return false;
  // dhcrelay's -c 10, and a request it relayed itself coming back: dropped, so two relays cannot feed each other.
  const hops = msg.hops ?? 0;
  if (hops >= MAX_HOPS || server.portNames().some((p) => server.ifaceConfig(p)?.ip === msg.giaddr)) return false;
  const relayed: DhcpMessage = { ...msg, giaddr: msg.giaddr || own, hops: hops + 1 };
  for (const dst of r.servers) {
    server.log('relay', `Forwarded BOOTREQUEST for ${hw(msg.chaddr)} to ${formatIp(dst)}`);
    server.sendUdp(dst, DHCP_SERVER_PORT, DHCP_SERVER_PORT, { dhcp: relayed });
  }
  return false;
}
