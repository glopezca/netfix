/**
 * The templated unit wg-quick@IFACE.service (Linux router): start/stop/restart run wg-quick (its output
 * goes to the journal, not the terminal), enable/disable manage the multi-user.target.wants symlink that
 * the router reads at boot, status/is-active/is-enabled report it.
 */
import type { Ctx, Fds, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';

export const WANTS_DIR = '/etc/systemd/system/multi-user.target.wants';
const TEMPLATE = '/usr/lib/systemd/system/wg-quick@.service';
const QUIET: Fds = new Map([[1, { write: { kind: 'null' } }], [2, { write: { kind: 'null' } }]]);

/** `wg-quick@wg0[.service]` → wg0. */
export function wgUnitName(arg: string | undefined): string | undefined {
  return /^wg-quick@([a-zA-Z0-9_=+.-]{1,15}?)(?:\.service)?$/.exec(arg ?? '')?.[1];
}

const wantsPath = (iface: string): string => `${WANTS_DIR}/wg-quick@${iface}.service`;

export function wgUnitEnabled(fs: Vfs, iface: string): boolean {
  return fs.tryLookup(wantsPath(iface), undefined, false) !== undefined;
}

/** Interfaces whose unit is enabled (brought up at boot). */
export function enabledWgUnits(fs: Vfs): string[] {
  if (fs.tryLookup(WANTS_DIR)?.kind !== 'dir') return [];
  return fs.readdir(WANTS_DIR).map((n) => wgUnitName(n)).filter((n): n is string => n !== undefined);
}

function status(ctx: Ctx, host: Host, iface: string): number {
  const active = host.wgLinks()?.get(iface) !== undefined;
  ctx.out([
    `${active ? '●' : '○'} wg-quick@${iface}.service - WireGuard via wg-quick(8) for ${iface}`,
    `     Loaded: loaded (${TEMPLATE}; ${wgUnitEnabled(ctx.sh.env.fs, iface) ? 'enabled' : 'disabled'}; preset: enabled)`,
    active ? '     Active: active (exited)' : '     Active: inactive (dead)',
    '       Docs: man:wg-quick(8)',
    '             man:wg(8)',
  ].join('\n') + '\n');
  return active ? 0 : 3;
}

function* start(ctx: Ctx, host: Host, iface: string): Gen<number> {
  if (host.wgLinks()?.get(iface)) return 0;
  const code = yield* ctx.sh.invoke(['wg-quick', 'up', iface], QUIET);
  if (code === 0) return 0;
  ctx.err(`Job for wg-quick@${iface}.service failed because the control process exited with error code.\nSee "systemctl status wg-quick@${iface}.service" and "journalctl -xeu wg-quick@${iface}.service" for details.\n`);
  return 1;
}

function* stop(ctx: Ctx, host: Host, iface: string): Gen<number> {
  if (host.wgLinks()?.get(iface)) yield* ctx.sh.invoke(['wg-quick', 'down', iface], QUIET);
  return 0;
}

function setEnabled(ctx: Ctx, iface: string, on: boolean): void {
  const fs = ctx.sh.env.fs;
  if (on) {
    if (!wgUnitEnabled(fs, iface)) {
      fs.mkdir(WANTS_DIR, ctx.cred, true, 0o755);
      fs.symlink(TEMPLATE, wantsPath(iface), ctx.cred);
    }
    ctx.err(`Created symlink ${wantsPath(iface)} → ${TEMPLATE}.\n`);
  } else if (wgUnitEnabled(fs, iface)) {
    fs.remove(wantsPath(iface), ctx.cred);
    ctx.err(`Removed "${wantsPath(iface)}".\n`);
  }
}

/** systemctl VERB wg-quick@IFACE. */
export function* wgUnit(ctx: Ctx, host: Host, verb: string, iface: string, now: boolean): Gen<number> {
  const writes = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (writes.includes(verb) && ctx.cred.uid !== 0) {
    ctx.err(`Failed to ${verb} wg-quick@${iface}.service: Interactive authentication required.\nSee system logs and 'systemctl status wg-quick@${iface}.service' for details. (Prueba con sudo)\n`);
    return 1;
  }
  switch (verb) {
    case 'status': return status(ctx, host, iface);
    case 'is-active': ctx.out(host.wgLinks()?.get(iface) ? 'active\n' : 'inactive\n'); return host.wgLinks()?.get(iface) ? 0 : 3;
    case 'is-enabled': ctx.out(wgUnitEnabled(ctx.sh.env.fs, iface) ? 'enabled\n' : 'disabled\n'); return wgUnitEnabled(ctx.sh.env.fs, iface) ? 0 : 1;
    case 'start': return yield* start(ctx, host, iface);
    case 'stop': return yield* stop(ctx, host, iface);
    case 'restart': case 'reload':
      yield* stop(ctx, host, iface);
      return yield* start(ctx, host, iface);
    case 'enable': setEnabled(ctx, iface, true); return now ? yield* start(ctx, host, iface) : 0;
    case 'disable': setEnabled(ctx, iface, false); return now ? yield* stop(ctx, host, iface) : 0;
    default: ctx.err(`Unknown command verb '${verb}'.\n`); return 1;
  }
}
