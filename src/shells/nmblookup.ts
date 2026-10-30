/** nmblookup (samba-common-bin): NetBIOS name queries by broadcast, and node status with -A. */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { WORKSTATION, nbnsAsk } from '../net/netbios.ts';
import { broadcastOf, formatIp, parseIp } from '../core/ip.ts';

function status(ctx: Ctx, host: Host, target: string): number {
  ctx.out(`Looking up status of ${target}\n`);
  const ip = parseIp(target);
  const r = ip === null ? undefined : nbnsAsk(host, { type: 'NBSTAT', name: '*', suffix: WORKSTATION, broadcast: false }, ip);
  if (!r?.names) { ctx.out(`No reply from ${target}\n\n`); return 1; }
  const rows = r.names.map((n) => `\t${n.name.padEnd(15)} <${n.suffix.toString(16).padStart(2, '0')}> - ${n.group ? '<GROUP>' : '       '} B <ACTIVE> `);
  ctx.out(`${rows.join('\n')}\n\n\tMAC Address = ${(r.mac?.match(/../g) ?? []).join('-').toUpperCase()}\n\n`);
  return 0;
}

function query(ctx: Ctx, host: Host, name: string): number {
  const a = host.l3Ifaces().find((i) => i.up && i.addrs.length)?.addrs[0];
  ctx.out(`querying ${name} on ${a ? formatIp(broadcastOf(a.ip, a.prefix)) : '0.0.0.0'}\n`);
  const r = nbnsAsk(host, { type: 'NB', name, suffix: WORKSTATION, broadcast: true });
  const ip = r?.addresses?.[0];
  if (ip === undefined) { ctx.out(`name_query failed to find name ${name}\n`); return 1; }
  ctx.out(`${formatIp(ip)} ${name}<00>\n`);
  return 0;
}

export function nmblookup(host: Host): CommandFn {
  return (ctx) => {
    if (!hasPackage(host, 'samba-common-bin')) {
      ctx.err("Command 'nmblookup' not found, but can be installed with:\nsudo apt install samba-common-bin\n");
      return 127;
    }
    const args = ctx.argv.slice(1);
    const a = args.indexOf('-A');
    const target = a >= 0 ? args[a + 1] : args.find((x) => !x.startsWith('-'));
    if (!target) { ctx.err('Usage: nmblookup [-A] NAME|IP\n'); return 1; }
    return a >= 0 ? status(ctx, host, target) : query(ctx, host, target);
  };
}
