/**
 * The marking budget: a cheap look at an untrusted topology file before simulating it. Loading costs grow with the
 * devices (each host boots a Linux system) and with the IOS configuration replayed line by line, which the work
 * limit of the simulation does not count; a file far beyond any classroom lab is refused here, with a reason.
 */
export const MARK_MAX_DEVICES = 60;
export const MARK_MAX_CONFIG_LINES = 6000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const lines = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Throws when `file` is clearly beyond what marking should load (it is validated in full when loaded). */
export function checkMarkingBudget(file: unknown): void {
  const devices = isRecord(file) && Array.isArray(file.devices) ? file.devices : [];
  if (devices.length > MARK_MAX_DEVICES) throw new Error(`Demasiados equipos para corregir (${devices.length}; máximo ${MARK_MAX_DEVICES}).`);
  const total = devices.reduce((n: number, d) => n + (isRecord(d) ? lines(d.config) + lines(d.startup) : 0), 0);
  if (total > MARK_MAX_CONFIG_LINES) throw new Error(`Demasiadas líneas de configuración para corregir (${total}; máximo ${MARK_MAX_CONFIG_LINES}).`);
}
