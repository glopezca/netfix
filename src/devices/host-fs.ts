/**
 * Access from devices to the Linux file system of a host (the shells layer owns it). The shells
 * register a provider when loaded, so devices never import them (no import cycle).
 */
import type { Vfs } from '../bash/vfs.ts';
import type { Host } from './host.ts';

let provider: ((host: Host) => Vfs) | undefined;

export function registerHostFs(p: (host: Host) => Vfs): void {
  provider = p;
}

/** The host's file system, or undefined when no shell layer is loaded (pure device tests). */
export function hostFs(host: Host): Vfs | undefined {
  return provider?.(host);
}
