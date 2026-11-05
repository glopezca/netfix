/**
 * /etc/systemd/resolved.conf as systemd-resolved reads it (systemd's conf-parser): `[Section]` headers, `Key=Value`
 * with the blanks around both stripped, `#` and `;` comments, case-sensitive keys, the last assignment winning, and a
 * warning (to the unit's journal) for what it ignores. Only LLMNR= and MulticastDNS= change what Netfix does. The file
 * is untrusted (root may write anything, a topology may carry anything): its size, lines and warnings are capped.
 */

export const RESOLVED_CONF = '/etc/systemd/resolved.conf';

/** resolved's ResolveSupport: `resolve` asks but does not answer; `yes` does both. */
export type ResolveSupport = 'no' | 'resolve' | 'yes';

export interface ResolvedConf {
  readonly llmnr: ResolveSupport;
  readonly mdns: ResolveSupport;
  /** What systemd logs as it reads the file (`/etc/systemd/resolved.conf:N: …`). */
  readonly warnings: readonly string[];
}

/** Ubuntu builds resolved with -Ddefault-llmnr=no -Ddefault-mdns=no. */
export const RESOLVED_DEFAULTS: ResolvedConf = { llmnr: 'no', mdns: 'no', warnings: [] };

const MAX_BYTES = 65_536;
const MAX_LINES = 4096;
const MAX_WARNINGS = 32;
/** What a warning quotes of a value or a header. */
const MAX_QUOTE = 256;

const KNOWN_KEYS = new Set([
  'DNS', 'FallbackDNS', 'Domains', 'LLMNR', 'MulticastDNS', 'DNSSEC', 'DNSOverTLS', 'Cache', 'CacheFromLocalhost',
  'DNSStubListener', 'DNSStubListenerExtra', 'ReadEtcHosts', 'ResolveUnicastSingleLabel', 'StaleRetentionSec', 'RefuseRecordTypes',
]);
const TRUE = new Set(['1', 'yes', 'y', 'true', 't', 'on']);
const FALSE = new Set(['0', 'no', 'n', 'false', 'f', 'off']);

/** systemd's parse_boolean (any case), then the string table (exact): yes, no, resolve. */
function parseSupport(value: string): ResolveSupport | undefined {
  const lower = value.toLowerCase();
  if (TRUE.has(lower)) return 'yes';
  if (FALSE.has(lower)) return 'no';
  return value === 'resolve' ? 'resolve' : undefined;
}

interface State {
  section: string | undefined;
  /** In a section resolved does not know: its lines are skipped without a word. */
  skipping: boolean;
  llmnr: ResolveSupport;
  mdns: ResolveSupport;
  readonly warnings: string[];
}

// Control characters become «?»: an escape sequence in the file must not recolour or clear the terminal of journalctl.
const quote = (s: string): string => s.slice(0, MAX_QUOTE).replace(/[\x00-\x1f\x7f]/g, '?');

function warn(s: State, line: number, text: string): void {
  if (s.warnings.length < MAX_WARNINGS) s.warnings.push(`${RESOLVED_CONF}:${line}: ${text}`);
}

function header(s: State, n: number, l: string): void {
  if (!l.endsWith(']')) {
    warn(s, n, `Invalid section header '${quote(l)}'`);
    return;
  }
  const name = l.slice(1, -1);
  s.section = name;
  s.skipping = name !== 'Resolve';
  if (s.skipping && !name.startsWith('X-')) warn(s, n, `Unknown section '${quote(name)}'. Ignoring.`);
}

function assignment(s: State, n: number, l: string): void {
  if (s.section === undefined) return warn(s, n, 'Assignment outside of section. Ignoring.');
  if (s.skipping) return;
  const eq = l.indexOf('=');
  if (eq < 0) return warn(s, n, "Missing '=', ignoring line.");
  const key = l.slice(0, eq).trim();
  const value = l.slice(eq + 1).trim();
  if (!KNOWN_KEYS.has(key)) return warn(s, n, `Unknown key '${quote(key)}' in section [Resolve], ignoring.`);
  if (key !== 'LLMNR' && key !== 'MulticastDNS') return;
  const v = parseSupport(value);
  if (v === undefined) return warn(s, n, `Failed to parse ${key}=${quote(value)}, ignoring.`);
  if (key === 'LLMNR') s.llmnr = v;
  else s.mdns = v;
}

export function parseResolvedConf(text: string): ResolvedConf {
  const s: State = { section: undefined, skipping: false, llmnr: RESOLVED_DEFAULTS.llmnr, mdns: RESOLVED_DEFAULTS.mdns, warnings: [] };
  const lines = text.slice(0, MAX_BYTES).split('\n', MAX_LINES);
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (l === '' || l.startsWith('#') || l.startsWith(';')) return;
    if (l.startsWith('[')) header(s, i + 1, l);
    else assignment(s, i + 1, l);
  });
  return { llmnr: s.llmnr, mdns: s.mdns, warnings: s.warnings };
}

/** The file Ubuntu ships (systemd 258): every setting commented out at its compile-time default. */
export const DEFAULT_RESOLVED_CONF = `#  This file is part of systemd.
#
#  systemd is free software; you can redistribute it and/or modify it under the
#  terms of the GNU Lesser General Public License as published by the Free
#  Software Foundation; either version 2.1 of the License, or (at your option)
#  any later version.
#
# Entries in this file show the compile time defaults. Local configuration
# should be created by either modifying this file (or a copy of it placed in
# /etc/ if the original file is shipped in /usr/), or by creating "drop-ins" in
# the /etc/systemd/resolved.conf.d/ directory. The latter is generally
# recommended. Defaults can be restored by simply deleting the main
# configuration file and all drop-ins located in /etc/.
#
# Use 'systemd-analyze cat-config systemd/resolved.conf' to display the full config.
#
# See resolved.conf(5) for details.

[Resolve]
# Some examples of DNS servers which may be used for DNS= and FallbackDNS=:
# Cloudflare: 1.1.1.1#cloudflare-dns.com 1.0.0.1#cloudflare-dns.com 2606:4700:4700::1111#cloudflare-dns.com 2606:4700:4700::1001#cloudflare-dns.com
# Google:     8.8.8.8#dns.google 8.8.4.4#dns.google 2001:4860:4860::8888#dns.google 2001:4860:4860::8844#dns.google
# Quad9:      9.9.9.9#dns.quad9.net 149.112.112.112#dns.quad9.net 2620:fe::fe#dns.quad9.net 2620:fe::9#dns.quad9.net
#DNS=
#FallbackDNS=
#Domains=
#DNSSEC=no
#DNSOverTLS=no
#MulticastDNS=no
#LLMNR=no
#Cache=no-negative
#CacheFromLocalhost=no
#DNSStubListener=yes
#DNSStubListenerExtra=
#ReadEtcHosts=yes
#ResolveUnicastSingleLabel=no
#StaleRetentionSec=0
`;

const NEGATIVE_ANCHORS = ['home.arpa', '10.in-addr.arpa', ...Array.from({ length: 16 }, (_, i) => `${16 + i}.172.in-addr.arpa`), '168.192.in-addr.arpa', 'd.f.ip6.arpa', 'ipv4only.arpa', 'resolver.arpa', 'corp', 'home', 'internal', 'intranet', 'lan', 'local', 'private', 'test'];

/** What resolved logs as it starts: its DNSSEC trust anchors, then the host name it answers LLMNR and mDNS for. */
export function resolvedStartLines(hostname: string): string[] {
  return [
    'Positive Trust Anchors:',
    '. IN DS 20326 8 2 e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d',
    '. IN DS 38696 8 2 683d2d0acb8c9b712a1948b27f741219298d0a450d612c483af444a4c0fb2b16',
    `Negative trust anchors: ${NEGATIVE_ANCHORS.join(' ')}`,
    `Using system hostname '${hostname}'.`,
  ];
}
