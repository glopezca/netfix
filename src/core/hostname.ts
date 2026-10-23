/** Host name of a device derived from the name shown in the workspace (Equipo → Nombre). */

/** One DNS label (RFC 1123): at most 63 characters. */
const MAX_LABEL = 63;
const FALLBACK = 'equipo';

/** Lowercase, accents and ñ to plain letters, anything else to single hyphens, none at the ends. */
export function hostnameFromLabel(label: string): string {
  const plain = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = plain.slice(0, MAX_LABEL).replace(/-+$/, '');
  return cut || FALLBACK;
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
