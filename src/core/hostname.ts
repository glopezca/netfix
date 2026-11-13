/** Host name of a device derived from the name shown in the workspace (Equipo → Nombre). */

/** One DNS label (RFC 1123): at most 63 characters. */
const MAX_LABEL = 63;
/** HOST_NAME_MAX of Linux, which systemd-hostnamed applies to the whole name. */
export const MAX_HOSTNAME = 64;
const FALLBACK = 'equipo';

/** Tidy labels: no empty ones (`a..b`), no hyphen at their edges. */
const tidyLabels = (name: string): string => name.split('.').map((l) => l.replace(/^-+|-+$/g, '')).filter(Boolean).join('.');

/**
 * As Ubuntu keeps it: case kept, accents and ñ to plain letters, dots kept (an FQDN is a valid static name), anything
 * else to single hyphens; labels without a hyphen at their edges, at most 64 characters in all (systemd's rules).
 */
export function hostnameFromLabel(label: string): string {
  const plain = tidyLabels(label.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.]+/g, '-'));
  return tidyLabels(plain.slice(0, MAX_HOSTNAME)) || FALLBACK;
}


/** The first label: what avahi, LLMNR and NetBIOS announce of a host name with dots (srv.aula.lab → srv). */
export const shortHostname = (name: string): string => name.split('.')[0] || name;

/** What systemd's hostname_is_valid takes: LDH labels (case kept), no hyphen at their edges, 64 characters at most. */
const SYSTEM_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
export const validSystemName = (name: string): boolean => name.length <= MAX_HOSTNAME && SYSTEM_NAME.test(name);

/**
 * systemd's hostname_cleanup: what hostnamectl set-hostname keeps of a name it does not take as it is (that name goes
 * to the pretty name): letters, digits, hyphens and dots, case kept; no empty labels nor hyphens at their edges.
 */
export function hostnameCleanup(name: string): string {
  return tidyLabels(name.replace(/[^A-Za-z0-9.-]/g, '')).slice(0, MAX_HOSTNAME).replace(/[.-]+$/, '');
}

const IOS_FALLBACK: Readonly<Record<'router' | 'switch', string>> = { router: 'Router', switch: 'Switch' };

/**
 * IOS `hostname` of a router or switch from its workspace name: case kept, accents and ñ to plain letters, anything
 * else to single hyphens; it must start with a letter (else «Router-…» / «Switch-…»), at most 63 characters.
 */
export function iosHostnameFromLabel(label: string, kind: 'router' | 'switch'): string {
  const plain = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const named = !plain ? IOS_FALLBACK[kind] : /^[A-Za-z]/.test(plain) ? plain : `${IOS_FALLBACK[kind]}-${plain}`;
  return named.slice(0, MAX_LABEL).replace(/-+$/, '');
}
