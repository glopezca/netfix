/**
 * The service files root edits by hand (Fase 59): each entry names the unit that reads them, which paths are its
 * files, the part of the model they are written from, and the check its start or reload runs (which says what the
 * files change in the model). host-system.ts makes these paths root's 644 files saved with the lab, hand-edits.ts
 * follows the model with them, and the unit's start reads them. A new service adds its entry here
 * (.claude/rules/project/service-config-files.md).
 */
import type { Server } from '../devices/server.ts';
import type { CheckMode, UnitCheck } from '../devices/unit-checks.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { ServerServices } from '../services/config.ts';
import type { UnitId } from '../services/units.ts';
import { KEA_DHCP4_CONF } from './apt-defaults.ts';
import { keaStart } from './service-files.ts';
import { namedStart } from './named-start.ts';
import { dovecotStart, postfixStart } from './mail-start.ts';
import { MAIN_CF } from '../services/postfix-conf.ts';
import { DOVECOT_CONF } from '../services/dovecot-conf.ts';

export interface EditableConfig {
  /** The unit that reads the files (also the family hand-edits.ts follows). */
  readonly unit: UnitId;
  /** Whether a path is one of its files. */
  readonly owns: (path: string) => boolean;
  /** The directories above the files: a saved lab may not replace them (by a link, say). */
  readonly dirs: readonly string[];
  /** The part of the model the files are written from (whether the unit runs is not part of it). */
  readonly model: (s: ServerServices) => unknown;
  /** The unit's start or reload: the files checked and what they change in the model, or why it failed. */
  readonly check: (server: Server, fs: Vfs, mode: CheckMode) => UnitCheck;
}

const BIND_FILE = /^\/etc\/bind\/[^/]+$/;

export const EDITABLE_CONFIGS: readonly EditableConfig[] = [
  {
    unit: 'dhcp', owns: (p) => p === KEA_DHCP4_CONF, dirs: ['/etc', '/etc/kea'],
    model: (s) => ({ ...s.dhcp, enabled: undefined }), check: (srv, fs) => keaStart(srv, fs),
  },
  {
    unit: 'dns', owns: (p) => BIND_FILE.test(p), dirs: ['/etc', '/etc/bind'],
    model: (s) => ({ ...s.dns, enabled: undefined, unloaded: undefined }), check: namedStart,
  },
  { unit: 'smtp', owns: (p) => p === MAIN_CF, dirs: ['/etc', '/etc/postfix'], model: (s) => s.mail.domain, check: postfixStart },
  // dovecot.conf is written from the POP3/IMAP switches, which are also whether dovecot runs: a stop must not rewrite it.
  { unit: 'mailbox', owns: (p) => p === DOVECOT_CONF, dirs: ['/etc', '/etc/dovecot'], model: () => '', check: dovecotStart },
];

/** The entry whose files include the path. */
export const editableOf = (path: string): EditableConfig | undefined => EDITABLE_CONFIGS.find((c) => c.owns(path));
