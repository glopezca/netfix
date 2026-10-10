/** Deterministic, non-cryptographic stand-in for IOS type-5 secrets (simulation only). */
export function secretHash(text: string): string {
  let h = 5381;
  for (const ch of text) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `$1$mERr$${h.toString(36).padStart(7, '0')}${text.length}`;
}
