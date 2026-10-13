/** known_hosts lines: "name[,name…] keytype base64", with "[host]:port" for ports other than 22. */

/** Whether a known_hosts host field names `host` (or "[host]:port"). */
export function knownHostsMatches(field: string, host: string): boolean {
  const wanted = host.toLowerCase();
  return field.split(',').some((n) => n.toLowerCase() === wanted);
}

export interface KnownLine {
  readonly line: number;
  readonly text: string;
}

export function knownHostsFind(text: string, host: string): KnownLine[] {
  return text.split('\n').flatMap((l, i) => {
    const t = l.trim();
    const field = t.split(/\s+/)[0] ?? '';
    return t && !t.startsWith('#') && knownHostsMatches(field, host) ? [{ line: i + 1, text: t }] : [];
  });
}

/** known_hosts without the lines of `host`; `removed` = their line numbers. */
export function knownHostsRemove(text: string, host: string): { text: string; removed: number[] } {
  const found = new Set(knownHostsFind(text, host).map((f) => f.line));
  const kept = text.split('\n').filter((_, i) => !found.has(i + 1));
  return { text: kept.join('\n'), removed: [...found] };
}
