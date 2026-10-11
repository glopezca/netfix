/** Packet Tracer-style PC: a host with client applications (browser, mail, SSH, terminals). */
import { Host, HOST_PORT } from './host.ts';
import type { HostIpConfig } from './host.ts';
import type { MailAccount } from '../clients/mail-client.ts';
import type { MailMessage } from '../net/packets.ts';

export type { IpMode, DhcpStatus } from './host.ts';
export type PcIpConfig = HostIpConfig;
export const PC_PORT = HOST_PORT;

export class Pc extends Host {
  readonly kind = 'pc' as const;
  /** E-mail app state (kept with the topology). */
  mailAccount: MailAccount | undefined;
  inbox: MailMessage[] = [];
  /** Last URL typed in the web browser. */
  browserUrl = '';
}
