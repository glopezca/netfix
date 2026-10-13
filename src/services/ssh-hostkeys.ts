/** Host keys of a server's sshd: /etc/ssh/ssh_host_*_key(.pub), derived from the device so they are stable. */
import { keyFromSeed, privateFile, publicLine, parsePrivateFile } from '../net/ssh-keys.ts';
import type { KeyPair, KeyType } from '../net/ssh-keys.ts';
import { sha256, concatBytes, utf8 } from '../core/sha256.ts';

export const HOST_KEY_PATH = '/etc/ssh/ssh_host_ed25519_key';
const HOST_KEYS: readonly (readonly [KeyType, number])[] = [['ed25519', 256], ['ecdsa', 256], ['rsa', 3072]];

/** Deterministic bytes, so the seeded files are identical every time the workspace is opened. */
function seededRandom(seed: string): (n: number) => Uint8Array {
  let counter = 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 32) out.set(sha256(concatBytes(utf8(seed), Uint8Array.of(counter++ & 0xff))).slice(0, Math.min(32, n - i)), i);
    return out;
  };
}

/** Files to seed in a server: private keys (0600) and public keys (0644). */
export function hostKeyFiles(identity: string, hostname: string): { path: string; content: string; mode: number }[] {
  return HOST_KEYS.flatMap(([type, bits]) => {
    const kp = keyFromSeed(type, bits, `${identity}:ssh-host-${type}`, `root@${hostname}`);
    const base = `/etc/ssh/ssh_host_${type}_key`;
    return [
      { path: base, content: privateFile(kp, '', seededRandom(`${identity}:${type}`)), mode: 0o600 },
      { path: `${base}.pub`, content: `${publicLine(kp)}\n`, mode: 0o644 },
    ];
  });
}

/** The ED25519 host key sshd offers, read from its private file. */
export function loadHostKey(text: string | null): KeyPair | null {
  if (text === null) return null;
  const kp = parsePrivateFile(text, '');
  return typeof kp === 'string' ? null : kp;
}
