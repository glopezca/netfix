/**
 * nmblookup (samba-common-bin): NetBIOS name queries by broadcast (the own name answered here; `localhost` is no NetBIOS
 * name, as on Windows), or by unicast to one address with -U (-R sets «recursion desired», so a WINS server looks the
 * name up in its database), and node status with -A (of an address) or -S (of what the query finds).
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { WORKSTATION, nbnsAsk, netbiosName, ownNames, speaksNetbios } from '../net/netbios.ts';
import { broadcastOf, formatIp, parseIp } from '../core/ip.ts';

const USAGE = 'Usage: nmblookup [-A] [-S] [-U UNICAST-ADDRESS] [-R] NAME|IP\n';

interface Options {
  readonly status: boolean;
  /** -S: after the query, the node status of the address found. */
  readonly lookupStatus: boolean;
  readonly recurse: boolean;
  readonly unicast?: string;
  readonly target?: string;
}

function status(ctx: Ctx, host: Host, target: string): number {
  ctx.out(`Looking up status of ${target}\n`);
  const ip = parseIp(target);
  const r = ip === null ? undefined : nbnsAsk(host, { type: 'NBSTAT', name: '*', suffix: WORKSTATION, broadcast: false }, ip);
  if (!r?.names) { ctx.out(`No reply from ${target}\n\n`); return 1; }
  const rows = r.names.map((n) => `\t${n.name.padEnd(15)} <${n.suffix.toString(16).padStart(2, '0')}> - ${n.group ? '<GROUP>' : '       '} B <ACTIVE> `);
  ctx.out(`${rows.join('\n')}\n\n\tMAC Address = ${(r.mac?.match(/../g) ?? []).join('-').toUpperCase()}\n\n`);
  return 0;
}

/** The host answers itself: its own name when nmbd (samba) runs and hears its broadcast. */
function local(host: Host, name: string, own: number | undefined): number | undefined {
  const mine = speaksNetbios(host) && ownNames(host).some((n) => !n.group && n.suffix === WORKSTATION && n.name === netbiosName(name));
  return mine ? own : undefined;
}

/** A unicast question to one address; a negative answer (NAM_ERR from a WINS server) finds nothing. */
function unicast(host: Host, name: string, to: string, recurse: boolean): number | undefined {
  const ip = parseIp(to);
  const r = ip === null ? undefined : nbnsAsk(host, { type: 'NB', name, suffix: WORKSTATION, broadcast: false, rd: recurse }, ip);
  return r && (r.rcode ?? 0) === 0 ? r.addresses?.[0] : undefined;
}

function query(ctx: Ctx, host: Host, name: string, o: Options): number {
  const a = host.l3Ifaces().find((i) => i.up && i.addrs.length)?.addrs[0];
  ctx.out(`querying ${name} on ${o.unicast ?? (a ? formatIp(broadcastOf(a.ip, a.prefix)) : '0.0.0.0')}\n`);
  const ip = o.unicast !== undefined
    ? unicast(host, name, o.unicast, o.recurse)
    : local(host, name, a?.ip) ?? nbnsAsk(host, { type: 'NB', name, suffix: WORKSTATION, broadcast: true })?.addresses?.[0];
  if (ip === undefined) { ctx.out(`name_query failed to find name ${name}\n`); return 1; }
  ctx.out(`${formatIp(ip)} ${name}<00>\n`);
  return o.lookupStatus ? status(ctx, host, formatIp(ip)) : 0;
}

/** -A, -S (the node status of what the query finds), -R and -U ADDRESS (or -UADDRESS, --unicast=ADDRESS); the first other word is the name. Null: a usage error. */
function parse(args: readonly string[]): Options | null {
  let o: Options = { status: false, lookupStatus: false, recurse: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-A') o = { ...o, status: true };
    else if (a === '-S') o = { ...o, lookupStatus: true };
    else if (a === '-R') o = { ...o, recurse: true };
    else if (a === '-U' || a === '--unicast') {
      const v = args[++i];
      if (v === undefined) return null;
      o = { ...o, unicast: v };
    } else if (a.startsWith('--unicast=')) o = { ...o, unicast: a.slice('--unicast='.length) };
    else if (/^-U./.test(a)) o = { ...o, unicast: a.slice(2) };
    else if (!a.startsWith('-') && o.target === undefined) o = { ...o, target: a };
  }
  return o.target === undefined ? null : o;
}

export function nmblookup(host: Host): CommandFn {
  return (ctx) => {
    if (!hasPackage(host, 'samba-common-bin')) {
      ctx.err("Command 'nmblookup' not found, but can be installed with:\nsudo apt install samba-common-bin\n");
      return 127;
    }
    if (ctx.argv.some((a) => a === '-h' || a === '--help' || a === '-?')) { ctx.out(USAGE); return 0; }
    const o = parse(ctx.argv.slice(1));
    if (!o?.target) { ctx.err(USAGE); return 1; }
    return o.status ? status(ctx, host, o.target) : query(ctx, host, o.target, o);
  };
}
