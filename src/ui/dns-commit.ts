/** Applying a DNS edit from the Services tab (shared by the mode blocks and the zone editor). */
import type { message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { Edited } from '../services/dns-edit.ts';

/** Applies an edit; the resolver cache is flushed when forwarding or recursion change (as `rndc reload`). */
export function commit(server: Server, app: AfterChange, msg: ReturnType<typeof message>, next: Edited, flush = false): boolean {
  if ('error' in next) { msg.error(next.error); return false; }
  msg.clear();
  server.setServices({ ...server.services, dns: next });
  if (flush) server.dns.forwarder.flush();
  app.afterCommand();
  return true;
}

