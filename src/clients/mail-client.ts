/** E-mail client used by the PC desktop: SMTP to send, POP3 or IMAP to receive. */
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
  if (kind === 'refused') return { ok: false, text: `El servidor ${server} rechazó la conexión ${proto} (puerto ${PORTS[proto as keyof typeof PORTS]}). ¿Está activo el servicio?` };
  if (kind === 'noroute') return { ok: false, text: `No hay ruta hacia ${server}. Revisa la IP y la puerta de enlace del PC.` };
  return { ok: false, text: `Tiempo de espera agotado conectando con ${server}.` };
}

export function sendMail(host: Host, account: MailAccount, to: readonly string[], subject: string, body: string): MailOutcome {
  if (to.length === 0) return { ok: false, text: 'Indica al menos un destinatario.' };
  const target = resolveHost(host, account.outgoing);
  if (target.kind === 'error') return { ok: false, text: `No se pudo resolver el servidor de correo saliente ${account.outgoing}.` };
  const mail: MailMessage = { from: account.address, to, subject, body, date: host.clock.now() };
  const r = tcpCall(host, target.ip, PORTS.SMTP, { app: 'SMTP', kind: 'request', helo: host.name, mail });
  if (r.kind !== 'ok') return connectError(account.outgoing, 'SMTP', r.kind);
  if (r.reply.kind !== 'reply') return { ok: false, text: 'Respuesta SMTP inesperada.' };
  return r.reply.code === '250' ? { ok: true, text: `${r.reply.code} ${r.reply.text}`, messages: [] } : { ok: false, text: `${r.reply.code} ${r.reply.text}` };
}

export function receiveMail(host: Host, account: MailAccount): MailOutcome {
  const target = resolveHost(host, account.incoming);
  if (target.kind === 'error') return { ok: false, text: `No se pudo resolver el servidor de correo entrante ${account.incoming}.` };
  const r = tcpCall(host, target.ip, PORTS[account.protocol], { app: account.protocol, kind: 'request', user: account.user, password: account.password });
  if (r.kind !== 'ok') return connectError(account.incoming, account.protocol, r.kind);
  if (r.reply.kind !== 'reply') return { ok: false, text: 'Respuesta inesperada del servidor.' };
  const ok = r.reply.code === '+OK' || r.reply.code === 'OK';
  return ok ? { ok: true, text: `${r.reply.code} ${r.reply.text}`, messages: r.reply.messages ?? [] } : { ok: false, text: `${r.reply.code} ${r.reply.text}` };
}
