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

let reader: ((host: Host, path: string) => string | undefined) | undefined;

/** Reads a file of a host's system only if it already exists (no system is built, no generated file refreshed). */
export function registerHostFileReader(r: (host: Host, path: string) => string | undefined): void {
  reader = r;
}

/** The content of a file in the host's system, or undefined when the system has not been created yet. */
export function peekHostFile(host: Host, path: string): string | undefined {
  return reader?.(host, path);
}

/** The host's file system, or undefined when no shell layer is loaded (pure device tests). */
export function hostFs(host: Host): Vfs | undefined {
  return provider?.(host);
}
