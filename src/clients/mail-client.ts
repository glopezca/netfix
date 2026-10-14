/** E-mail client used by the PC desktop: SMTP to send, POP3 or IMAP to receive. */
import { t } from '../i18n/t.ts';
import type { Host } from '../devices/host.ts';
import type { MailMessage } from '../net/packets.ts';
import { resolveHost, tcpCall } from '../shells/net-tools.ts';

export interface MailAccount {
  readonly name: string;
  readonly address: string;
  readonly incoming: string;
  readonly outgoing: string;
  readonly protocol: 'POP3' | 'IMAP';
  readonly user: string;
  readonly password: string;
}

export type MailOutcome =
  | { readonly ok: true; readonly text: string; readonly messages: readonly MailMessage[] }
  | { readonly ok: false; readonly text: string };

const PORTS = { SMTP: 25, POP3: 110, IMAP: 143 } as const;

function connectError(server: string, proto: string, kind: string): MailOutcome {
  if (kind === 'refused') return { ok: false, text: t('mailc.refused', { server, proto, port: PORTS[proto as keyof typeof PORTS] }) };
  if (kind === 'noroute') return { ok: false, text: t('mailc.noroute', { server }) };
  return { ok: false, text: t('mailc.timeout', { server }) };
}

export function sendMail(host: Host, account: MailAccount, to: readonly string[], subject: string, body: string): MailOutcome {
  if (to.length === 0) return { ok: false, text: t('mailc.noRecipient') };
  const target = resolveHost(host, account.outgoing);
  if (target.kind === 'error') return { ok: false, text: t('mailc.noOutgoing', { server: account.outgoing }) };
  const mail: MailMessage = { from: account.address, to, subject, body, date: host.clock.now() };
  const r = tcpCall(host, target.ip, PORTS.SMTP, { app: 'SMTP', kind: 'request', helo: host.name, mail });
  if (r.kind !== 'ok') return connectError(account.outgoing, 'SMTP', r.kind);
  if (r.reply.kind !== 'reply') return { ok: false, text: t('mailc.badSmtp') };
  return r.reply.code === '250' ? { ok: true, text: `${r.reply.code} ${r.reply.text}`, messages: [] } : { ok: false, text: `${r.reply.code} ${r.reply.text}` };
}

export function receiveMail(host: Host, account: MailAccount): MailOutcome {
  const target = resolveHost(host, account.incoming);
  if (target.kind === 'error') return { ok: false, text: t('mailc.noIncoming', { server: account.incoming }) };
  const r = tcpCall(host, target.ip, PORTS[account.protocol], { app: account.protocol, kind: 'request', user: account.user, password: account.password });
  if (r.kind !== 'ok') return connectError(account.incoming, account.protocol, r.kind);
  if (r.reply.kind !== 'reply') return { ok: false, text: t('mailc.badReply') };
  const ok = r.reply.code === '+OK' || r.reply.code === 'OK';
  return ok ? { ok: true, text: `${r.reply.code} ${r.reply.text}`, messages: r.reply.messages ?? [] } : { ok: false, text: `${r.reply.code} ${r.reply.text}` };
}
