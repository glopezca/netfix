/** SMTP, POP3 and IMAP over the simplified TCP: local delivery and relay to other domains via MX. */
import type { AppPayload, MailMessage } from '../net/packets.ts';
import type { Account } from './config.ts';

type Reply = Extract<AppPayload, { kind: 'reply' }>;

export interface MailEnv {
  readonly domain: string;
  readonly users: readonly Account[];
  readonly hostname: string;
  log(line: string): void;
  /** Delivers to a remote domain (MX lookup + SMTP). Called asynchronously. */
  relay(domain: string, mail: MailMessage, done: (ok: boolean, reason: string) => void): void;
}

export const MAX_RELAY_HOPS = 2;

export function splitAddress(address: string): { user: string; domain: string } | null {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(address.trim().toLowerCase());
  return m ? { user: m[1] ?? '', domain: m[2] ?? '' } : null;
}

export class Mailboxes {
  private readonly boxes = new Map<string, MailMessage[]>();

  list(user: string): readonly MailMessage[] {
    return this.boxes.get(user.toLowerCase()) ?? [];
  }

  deliver(user: string, mail: MailMessage): void {
    const key = user.toLowerCase();
    this.boxes.set(key, [...(this.boxes.get(key) ?? []), mail]);
  }

  take(user: string): readonly MailMessage[] {
    const key = user.toLowerCase();
    const all = this.boxes.get(key) ?? [];
    this.boxes.delete(key);
    return all;
  }

  toJSON(): Record<string, readonly MailMessage[]> {
    return Object.fromEntries(this.boxes);
  }

  load(data: Readonly<Record<string, readonly MailMessage[]>>): void {
    this.boxes.clear();
    for (const [user, mails] of Object.entries(data)) this.boxes.set(user, [...mails]);
  }

  count(): number {
    return [...this.boxes.values()].reduce((n, l) => n + l.length, 0);
  }
}

function reply(app: Reply['app'], code: string, text: string, messages?: readonly MailMessage[]): Reply {
  return { app, kind: 'reply', code, text, messages };
}

function authorized(env: MailEnv, user: string, password: string): boolean {
  return env.users.some((u) => u.name.toLowerCase() === user.toLowerCase() && u.password === password);
}

export function handleSmtp(env: MailEnv, boxes: Mailboxes, req: Extract<AppPayload, { app: 'SMTP'; kind: 'request' }>, peer: string): Reply {
  const { mail } = req;
  if (!splitAddress(mail.from)) return reply('SMTP', '501', '5.1.7 Bad sender address syntax');
  const accepted: string[] = [];
  for (const rcpt of mail.to) {
    const addr = splitAddress(rcpt);
    if (!addr) return reply('SMTP', '501', `5.1.3 Bad recipient address syntax: ${rcpt}`);
    if (addr.domain === env.domain.toLowerCase()) {
      if (!env.users.some((u) => u.name.toLowerCase() === addr.user)) return reply('SMTP', '550', `5.1.1 <${rcpt}>: Recipient address rejected: User unknown in local recipient table`);
      boxes.deliver(addr.user, mail);
      env.log(`postfix/local: to=<${rcpt}>, relay=local, status=sent (delivered to mailbox)`);
      accepted.push(rcpt);
      continue;
    }
    const hops = (mail.hops ?? 0) + 1;
    if (hops > MAX_RELAY_HOPS) {
      env.log(`postfix/smtpd: reject: RCPT from ${peer}: 554 5.4.6 <${rcpt}>: Too many hops (mail loop?)`);
      return reply('SMTP', '554', `5.4.6 <${rcpt}>: Too many hops`);
    }
    env.log(`postfix/smtp: to=<${rcpt}>, relay=${addr.domain}, status=deferred (queued for relay)`);
    env.relay(addr.domain, { ...mail, to: [rcpt], hops }, (ok, reason) =>
      env.log(`postfix/smtp: to=<${rcpt}>, status=${ok ? 'sent' : 'bounced'} (${reason})`));
    accepted.push(rcpt);
  }
  env.log(`postfix/smtpd: connect from ${peer}; from=<${mail.from}> nrcpt=${accepted.length}`);
  return reply('SMTP', '250', `2.0.0 Ok: queued as ${queueId(mail)}`);
}

export function handleRetrieve(env: MailEnv, boxes: Mailboxes, req: Extract<AppPayload, { app: 'POP3' | 'IMAP'; kind: 'request' }>, peer: string): Reply {
  const ok = authorized(env, req.user, req.password);
  const proto = req.app === 'POP3' ? 'pop3' : 'imap';
  env.log(`dovecot: ${proto}-login: ${ok ? 'Login' : 'Disconnected (auth failed, 1 attempts)'}: user=<${req.user}>, rip=${peer}`);
  if (!ok) return req.app === 'POP3' ? reply('POP3', '-ERR', '[AUTH] Authentication failed.') : reply('IMAP', 'NO', '[AUTHENTICATIONFAILED] Authentication failed.');
  if (req.app === 'POP3') {
    const mails = boxes.take(req.user);
    return reply('POP3', '+OK', `${mails.length} messages retrieved and deleted from server`, mails);
  }
  const mails = boxes.list(req.user);
  return reply('IMAP', 'OK', `${mails.length} messages in INBOX (kept on server)`, mails);
}

function queueId(mail: MailMessage): string {
  let h = 7;
  for (const ch of `${mail.from}${mail.subject}${mail.date}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).toUpperCase().padStart(10, '0').slice(0, 10);
}
