/** rndc (bind9's control tool): reload, flush and status on servers. */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { formatIp } from '../core/ip.ts';

const USAGE = 'Usage: rndc [-b address] [-c config] [-s server] [-p port]\n\t[-k key-file ] [-y key] [-r] [-V] [-4 | -6] command\n\ncommand is one of the following:\n\n  flush\t\tFlushes all of the server\'s caches.\n  reload\tReload configuration file and zones.\n  status\tDisplay status of the server.\n';

export function rndc(host: Host): CommandFn {
  return (ctx: Ctx): number => {
    const server = host as Server;
    const verb = ctx.argv[1] ?? '';
    if (!['flush', 'reload', 'status'].includes(verb)) { ctx.err(USAGE); return 1; }
    if (ctx.cred.uid !== 0) { ctx.err('rndc: open: /etc/bind/rndc.key: permission denied\nrndc: could not load rndc configuration\n'); return 1; }
    if (!server.services.dns.enabled) { ctx.err('rndc: connect failed: 127.0.0.1#953: connection refused\n'); return 1; }
    if (verb === 'flush') { server.dns.forwarder.flush(); return 0; }
    if (verb === 'reload') { ctx.out('server reload successful\n'); return 0; }
    const s = server.services.dns;
    ctx.out([
      'version: BIND 9.20.4-3ubuntu1-Ubuntu (Stable Release) <id:>',
      'running on localhost: Linux x86_64 6.17.0-14-generic',
      `number of zones: ${new Set(s.records.map((r) => r.name)).size > 0 ? 1 : 0} (99 automatic)`,
      `recursive clients: 0/900/1000`,
      `forwarders: ${(s.forwarders ?? []).map(formatIp).join(' ') || 'none'}`,
      `cache entries: ${server.dns.forwarder.cacheSize()}`,
      'server is up and running',
    ].join('\n') + '\n');
    return 0;
  };
}
