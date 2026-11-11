/**
 * postfix and dovecot read their files at start, restart and reload (`postfix reload`, `doveadm reload`): main.cf
 * gives the mail domain, dovecot.conf's protocols say whether POP3 and IMAP listen. A bad file stops the start (the
 * unit is failed) or, at a reload, keeps what runs. An untouched file is the one generated from the model.
 */
import type { Server } from '../devices/server.ts';
import type { CheckMode, UnitCheck } from '../devices/unit-checks.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { ServerServices } from '../services/config.ts';
import { ROOT } from '../bash/vfs.ts';
import { checkMainCf, MAIN_CF } from '../services/postfix-conf.ts';
import { DOVECOT_CONF, DOVECOT_VERSION, parseDovecotConf } from '../services/dovecot-conf.ts';

const OK: UnitCheck = { ok: true };
export const POSTFIX_IDENT = 'postfix/postfix-script[1021]';
const DOVECOT_IDENT = 'dovecot[1088]';

/** root's text of the file, or undefined while it is the generated one; null when it cannot be read. */
function edited(fs: Vfs, path: string): string | undefined | null {
  const node = fs.tryLookup(path, ROOT);
  if (node?.kind === 'file' && node.generated) return undefined;
  try {
    return fs.readFile(path, ROOT);
  } catch {
    return null;
  }
}

/** postfix's start or reload: postfix-script runs `postfix check` first; main.cf's domain becomes the model's. */
export function postfixStart(server: Server, fs: Vfs, mode: CheckMode): UnitCheck {
  if (server.os !== 'linux') return OK;
  const text = edited(fs, MAIN_CF);
  if (text === undefined) return OK;
  if (text === null) return { ok: false, ident: POSTFIX_IDENT, lines: [`fatal: open ${MAIN_CF}: No such file or directory`] };
  const c = checkMainCf(text);
  const warnings = c.warnings.map((w) => `warning: ${w}`);
  if (c.error !== undefined) return { ok: false, ident: POSTFIX_IDENT, lines: [...warnings, `fatal: ${c.error}`] };
  const done = mode === 'reload' ? 'refreshing the Postfix mail system' : 'starting the Postfix mail system';
  return { ok: true, ident: POSTFIX_IDENT, lines: [...warnings, done], apply: (s) => ({ ...s, mail: { ...s.mail, domain: c.domain } }) };
}

/** dovecot's start or reload: doveconf reads the file; protocols turns POP3 and IMAP on or off. */
export function dovecotStart(server: Server, fs: Vfs, mode: CheckMode): UnitCheck {
  if (server.os !== 'linux') return OK;
  const text = edited(fs, DOVECOT_CONF);
  if (text === undefined) return OK;
  const c = parseDovecotConf(text ?? '');
  const error = text === null ? `Error in configuration file ${DOVECOT_CONF}: open(${DOVECOT_CONF}) failed: No such file or directory` : c.error;
  if (error !== undefined) return { ok: false, ident: DOVECOT_IDENT, lines: [`doveconf: Fatal: ${error}`] };
  const pop3 = c.protocols.includes('pop3');
  const imap = c.protocols.includes('imap');
  const done = mode === 'reload' ? 'master: Warning: SIGHUP received - reloading configuration'
    : `master: Dovecot v${DOVECOT_VERSION} starting up for ${c.protocols.join(', ') || 'none'} (core dumps disabled)`;
  // shortcut: a file with neither pop3 nor imap leaves the panel's switches as they were (the model has no dovecot without them).
  const apply = pop3 || imap ? { apply: (s: ServerServices) => ({ ...s, mail: { ...s.mail, pop3, imap } }) } : {};
  return { ok: true, ident: DOVECOT_IDENT, lines: [done], ...apply };
}
