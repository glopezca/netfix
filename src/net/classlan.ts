/**
 * The Classroom LAN's link to the host page (Netfix Classroom): what a lab sends to the other labs open in the class and
 * what it gets from them. Bridged, Ethernet frames; NAT, IP packets between the labs' classroom addresses (lab k is
 * 10.k.0.0/16, its router's WAN 10.k.1.2). The host relays them; what arrives is untrusted (another pupil's browser)
 * and is checked here before the simulation sees it.
 */
import type { Frame, IpPacket } from './packets.ts';

export type ClassLanMessage = { readonly kind: 'frame'; readonly frame: Frame } | { readonly kind: 'ip'; readonly packet: IpPacket };

/** The host option `classroomLan` of netfix.lab/embed. */
export interface ClassLanLink {
  /** This lab's number in the class (1-250), given by the host: its classroom block is 10.lab.0.0/16. */
  readonly lab: number;
  /** The class's name, for the device's name (optional; up to 64 characters). */
  readonly name?: string;
  send(message: ClassLanMessage): void;
  /** Messages from the other labs; returns the function that stops listening. */
  onMessage(listener: (message: unknown) => void): () => void;
}

export const MAX_LAB = 250;
const CLASS_NET = 10 << 24;
/** A message bigger than this (serialized) is not a frame anyone builds by hand: dropped. */
export const MAX_MESSAGE_CHARS = 16_384;
const MAX_DEPTH = 12;
const MAC_RE = /^[0-9a-f]{12}$/;
const PROTOCOLS = ['icmp', 'udp', 'tcp', 'esp'];

/** The classroom block of lab k: 10.k.0.0/16. */
export function labBlock(lab: number): number {
  return (CLASS_NET + ((Math.max(0, Math.min(MAX_LAB, Math.trunc(lab))) & 0xff) << 16)) >>> 0;
}

export function validLab(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_LAB;
}

function plainDepth(v: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return typeof v !== 'number' || Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plainDepth(x, depth + 1));
  if (typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return false;
  return Object.values(v).every((x) => plainDepth(x, depth + 1));
}

const isIp = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

function validPacket(p: unknown): p is IpPacket {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return isIp(o.src) && isIp(o.dst) && typeof o.ttl === 'number' && o.ttl >= 0 && o.ttl <= 255 && PROTOCOLS.includes(String(o.protocol));
}

function validFrame(f: unknown): f is Frame {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  if (typeof o.src !== 'string' || typeof o.dst !== 'string' || !MAC_RE.test(o.src) || !MAC_RE.test(o.dst)) return false;
  if (o.vlan !== undefined && !(typeof o.vlan === 'number' && Number.isInteger(o.vlan) && o.vlan >= 1 && o.vlan <= 4094)) return false;
  return o.ip === undefined || validPacket(o.ip);
}

/** A message from the relay, or null: only plain data, small, with the fields the simulation relies on. */
export function classLanMessage(v: unknown): ClassLanMessage | null {
  let text: string;
  try {
    text = JSON.stringify(v);
  } catch {
    return null;
  }
  if (typeof text !== 'string' || text.length > MAX_MESSAGE_CHARS) return null;
  const copy: unknown = JSON.parse(text);
  if (!plainDepth(copy, 0) || typeof copy !== 'object' || copy === null) return null;
  const m = copy as Record<string, unknown>;
  if (m.kind === 'frame' && validFrame(m.frame)) return { kind: 'frame', frame: m.frame };
  if (m.kind === 'ip' && validPacket(m.packet)) return { kind: 'ip', packet: m.packet };
  return null;
}
