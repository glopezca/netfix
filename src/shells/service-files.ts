/**
 * The configuration files a unit reads when it starts, edited from the console: kea-dhcp4-server runs
 * `kea-dhcp4 -c /etc/kea/kea-dhcp4.conf`, which checks the file as `-t` does. A good file becomes the DHCP model; a bad
 * one makes Kea exit with status 1 and write why (Kea 2.6 under systemd: no timestamp, the logger, PID and thread).
 * An untouched file is the one generated from the model, so there is nothing to read back.
 */
import type { Server } from '../devices/server.ts';
import type { UnitCheck } from '../devices/unit-checks.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { ServerServices } from '../services/config.ts';
import { checkKeaConf } from '../services/kea-check.ts';
import type { KeaCheck } from '../services/kea-check.ts';
import { importKea } from '../services/kea-import.ts';
import { KEA_DHCP4_CONF } from './apt-defaults.ts';

const OK: UnitCheck = { ok: true };
const KEA_PID = 812;
const KEA_TID = '140245170644864';
const KEA_IDENT = `kea-dhcp4[${KEA_PID}]`;

/** The reason Kea gives when the configuration does not load: the error without what `-t` adds before it. */
const reasonOf = (c: KeaCheck): string => (c.error ?? '').replace(/^(?:Syntax check failed with: |Error encountered: )/, '');

/** What kea-dhcp4 writes as it exits: the parser's errors, then that the configuration did not load. */
function keaFailure(c: KeaCheck): string[] {
  const line = (logger: string, message: string): string => `ERROR [kea-dhcp4.${logger}/${KEA_PID}.${KEA_TID}] ${message}`;
  const reason = reasonOf(c);
  return [
    ...c.log.filter((l) => l.level === 'ERROR').map((l) => line(l.logger, l.message)),
    line('dhcp4', `DHCP4_CONFIG_LOAD_FAIL configuration error using file: ${KEA_DHCP4_CONF}, reason: ${reason}`),
    line('dhcp4', `DHCP4_INIT_FAIL failed to initialize Kea server: configuration error using file '${KEA_DHCP4_CONF}': ${reason}`),
  ];
}

/** The model with the pools and interfaces of the file. */
function applyKea(text: string): (s: ServerServices) => ServerServices {
  return (s) => {
    const imported = importKea(text, s.dhcp.pools);
    if (!imported) return s;
    const { interfaces: _, ...dhcp } = s.dhcp;
    const pools = imported.pools;
    return { ...s, dhcp: imported.interfaces === undefined ? { ...dhcp, pools } : { ...dhcp, pools, interfaces: imported.interfaces } };
  };
}

/** kea-dhcp4-server's start on a Linux server: the file root edited, checked and applied, or why Kea exited. */
export function keaStart(server: Server, fs: Vfs): UnitCheck {
  if (server.os !== 'linux') return OK;
  const node = fs.tryLookup(KEA_DHCP4_CONF);
  if (node?.kind === 'file' && node.generated) return OK;
  const text = node?.kind === 'file' ? fs.readFile(KEA_DHCP4_CONF) : undefined;
  const check = checkKeaConf(KEA_DHCP4_CONF, text ?? { error: 'unreadable' });
  if (!check.ok || text === undefined) return { ok: false, ident: KEA_IDENT, lines: keaFailure(check) };
  return { ok: true, apply: applyKea(text) };
}
