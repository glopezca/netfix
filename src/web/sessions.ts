/** Cookie sessions of the simulated web applications (kept in memory, never saved). */

const TTL_MS = 60 * 60_000;
const MAX_SESSIONS = 64;

function newId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Sessions<T> {
  private readonly map = new Map<string, { data: T; expires: number }>();

  create(data: T, now: number): string {
    for (const [id, s] of this.map) if (s.expires < now) this.map.delete(id);
    if (this.map.size >= MAX_SESSIONS) this.map.delete(this.map.keys().next().value ?? '');
    const id = newId();
    this.map.set(id, { data, expires: now + TTL_MS });
    return id;
  }

  get(id: string | undefined, now: number): T | undefined {
    const s = id ? this.map.get(id) : undefined;
    if (!s || s.expires < now) return undefined;
    s.expires = now + TTL_MS;
    return s.data;
  }

  drop(id: string | undefined): void {
    if (id) this.map.delete(id);
  }
}
