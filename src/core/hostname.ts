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

/**
 * Host name after renaming a device: derived from the new name while it still follows the old one (the default PC0,
 * or a derived one); a name set with hostnamectl is kept.
 */
export function hostnameAfterRename(current: string, oldLabel: string, newLabel: string): string {
  const follows = current === oldLabel || current.toLowerCase() === hostnameFromLabel(oldLabel);
  return follows ? hostnameFromLabel(newLabel) : current;
}
