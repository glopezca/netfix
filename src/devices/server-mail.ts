/** Postfix and Dovecot on a server: the environment mail-service.ts runs in, and relaying mail to another domain. */
import type { Server } from './server.ts';
import type { MailMessage } from '../net/packets.ts';
import type { MailEnv } from '../services/mail-service.ts';
import { firstAddress } from '../net/dns.ts';
import { formatIp } from '../core/ip.ts';

export const SMTP_PORT = 25;

/** MX lookup, then A lookup of the exchange, then SMTP to it. */
function relayMail(server: Server, domain: string, mail: MailMessage, done: (ok: boolean, reason: string) => void): void {
  server.lookup(domain, 'MX', (mx) => {
    const exchange = mx.kind === 'answer' ? [...(mx.msg.answers ?? [])].filter((a) => a.type === 'MX').sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0]?.data : undefined;
    const target = exchange ?? domain;
    server.lookup(target, 'A', (a) => {
      const ip = a.kind === 'answer' ? firstAddress(a.msg) : undefined;
      if (ip === undefined) {
        done(false, `Host or domain name not found. Name service error for name=${domain} type=MX`);
        return;
      }
      if (server.ownsIp(ip)) {
        done(false, `mail for ${domain} loops back to myself`);
        return;
      }
      server.connect(ip, SMTP_PORT, { app: 'SMTP', kind: 'request', helo: server.name, mail }, (r) => {
        const ok = r.kind === 'ok' && r.reply.app === 'SMTP' && r.reply.kind === 'reply' && r.reply.code === '250';
        const why = r.kind === 'ok' && r.reply.kind === 'reply' ? `${r.reply.code} ${r.reply.text}` : `connect to ${formatIp(ip)}:25: ${r.kind}`;
        done(ok, `relay=${target}[${formatIp(ip)}]:25, ${why}`);
      });
    });
  });
}

/** The server's mail domain, accounts and journal, and how it relays. */
export function mailEnv(server: Server): MailEnv {
  const m = server.services.mail;
  return {
    domain: m.domain,
    users: m.users,
    hostname: server.name,
    log: (line) => server.log(line.startsWith('dovecot') ? 'mailbox' : 'smtp', line),
    relay: (domain, mail, done) => { relayMail(server, domain, mail, done); },
  };
}
