/** Reading back what a topology file saves for PC applications and servers (untrusted until checked here). */
import type { PcRecord, ServerRecord } from './topology.ts';
import type { Pc } from '../devices/pc.ts';
import type { Server } from '../devices/server.ts';
import { servicesFromJson, mailboxesFromJson } from '../services/persist.ts';
import type { UnitId } from '../services/units.ts';
import type { MailAccount } from '../clients/mail-client.ts';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function restoreApps(pc: Pc, apps: NonNullable<PcRecord['apps']>): void {
  const m = apps.mail;
  if (isObject(m) && ['name', 'address', 'incoming', 'outgoing', 'user', 'password'].every((k) => typeof m[k as keyof MailAccount] === 'string')) {
    pc.mailAccount = { ...m, protocol: m.protocol === 'IMAP' ? 'IMAP' : 'POP3' };
  }
  if (apps.inbox !== undefined) pc.inbox = [...(mailboxesFromJson({ inbox: apps.inbox }).inbox ?? [])];
  if (typeof apps.url === 'string') pc.browserUrl = apps.url.slice(0, 2048);
}

export function restoreServer(server: Server, rec: ServerRecord): void {
  server.setServices(servicesFromJson(rec.services));
  const auto = isObject(rec.autostart) ? rec.autostart : {};
  for (const id of Object.keys(server.autostart) as UnitId[]) if (typeof auto[id] === 'boolean') server.autostart = { ...server.autostart, [id]: auto[id] };
  server.mailboxes.load(mailboxesFromJson(rec.mailboxes));
}
