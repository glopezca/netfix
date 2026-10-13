/**
 * Per-connection state of sshd before login: a random one-time challenge (the "session identifier"),
 * bound to the client address, with its failed attempts and the LoginGraceTime deadline.
 */
import { sha256, concatBytes, utf8, toBase64 } from '../core/sha256.ts';
import { cryptoRandom } from '../net/ssh-keys.ts';
import type { Random } from '../net/ssh-keys.ts';

const CHALLENGE_BYTES = 32;
const MAX_PENDING = 64;
/** Pending logins per client address: one client cannot push out the logins of others. */
const MAX_PER_IP = 8;
const GRACE_MS = 120_000;

/** What the server signs with its host key: the client's nonce and the challenge (host authentication). */
export function hostProofMessage(nonce: string, challenge: string): Uint8Array {
  return sha256(concatBytes(utf8('netfix-ssh-hostproof\0'), utf8(nonce), utf8('\0'), utf8(challenge)));
}

/**
 * What a client signs with its key: the challenge, the server's host key, the user and the key (like
 * SSH's userauth signature over the session id): a signature made for one server is useless at another.
 */
export function userAuthMessage(challenge: string, hostBlob: Uint8Array, user: string, keyLine: string): Uint8Array {
  return sha256(concatBytes(utf8('netfix-ssh-userauth\0'), utf8(challenge), utf8('\0'), sha256(hostBlob), utf8(user), utf8('\0'), utf8(keyLine)));
}

interface Pending {
  readonly ip: number;
  readonly created: number;
  failures: number;
}

export type ClaimResult = { ok: true; failures: number } | { ok: false; reason: 'unknown' | 'expired' };

export class PendingLogins {
  private readonly map = new Map<string, Pending>();
  private readonly random: Random;

  constructor(random: Random = cryptoRandom) {
    this.random = random;
  }

  /** New challenge for a connection from `ip`; null when the table is full of other clients' logins (MaxStartups). */
  issue(ip: number, now: number): string | null {
    for (const [k, p] of this.map) if (now - p.created > GRACE_MS) this.map.delete(k);
    const own = [...this.map].filter(([, p]) => p.ip === ip).map(([k]) => k);
    // Over its quota, a client replaces its own oldest login; when the table is full, also its own.
    const victim = own.length >= MAX_PER_IP || this.map.size >= MAX_PENDING ? own[0] : undefined;
    if (victim !== undefined) this.map.delete(victim);
    else if (this.map.size >= MAX_PENDING) return null;
    const challenge = toBase64(this.random(CHALLENGE_BYTES));
    this.map.set(challenge, { ip, created: now, failures: 0 });
    return challenge;
  }

  /** The connection of `challenge` if it belongs to `ip` and is within LoginGraceTime. */
  check(challenge: string, ip: number, now: number): ClaimResult {
    const p = this.map.get(challenge);
    if (!p || p.ip !== ip) return { ok: false, reason: 'unknown' };
    if (now - p.created > GRACE_MS) {
      this.map.delete(challenge);
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, failures: p.failures };
  }

  /** Counts a failed attempt; returns the total. */
  fail(challenge: string): number {
    const p = this.map.get(challenge);
    if (!p) return Number.MAX_SAFE_INTEGER;
    p.failures += 1;
    return p.failures;
  }

  /** Ends the connection's pre-login state (logged in, or disconnected). */
  close(challenge: string): void {
    this.map.delete(challenge);
  }
}
