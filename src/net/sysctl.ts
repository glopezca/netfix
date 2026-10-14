/**
 * Kernel parameters (sysctl) of a simulated Linux host, with Ubuntu's defaults. A few have effects in
 * Netfix (forwarding, ignoring pings, the host name); the rest are accepted and kept, as a lab expects.
 */

export interface SysctlKey {
  readonly name: string;
  readonly value: string;
  /** Accepted values: a list, or 'int'. */
  readonly accepts: readonly string[] | 'int' | 'text';
  /** True when the value changes behaviour in Netfix. */
  readonly effect: boolean;
}

const BOOL = ['0', '1'];

export const SYSCTL_KEYS: readonly SysctlKey[] = [
  { name: 'kernel.hostname', value: '', accepts: 'text', effect: true },
  { name: 'net.ipv4.conf.all.accept_redirects', value: '1', accepts: BOOL, effect: false },
  { name: 'net.ipv4.conf.all.forwarding', value: '0', accepts: BOOL, effect: true },
  { name: 'net.ipv4.conf.all.log_martians', value: '0', accepts: BOOL, effect: false },
  { name: 'net.ipv4.conf.all.rp_filter', value: '2', accepts: ['0', '1', '2'], effect: false },
  { name: 'net.ipv4.conf.all.send_redirects', value: '1', accepts: BOOL, effect: false },
  { name: 'net.ipv4.conf.default.rp_filter', value: '2', accepts: ['0', '1', '2'], effect: false },
  { name: 'net.ipv4.icmp_echo_ignore_all', value: '0', accepts: BOOL, effect: true },
  { name: 'net.ipv4.icmp_echo_ignore_broadcasts', value: '1', accepts: BOOL, effect: true },
  { name: 'net.ipv4.ip_default_ttl', value: '64', accepts: 'int', effect: false },
  { name: 'net.ipv4.ip_forward', value: '0', accepts: BOOL, effect: true },
  { name: 'net.ipv4.tcp_syncookies', value: '1', accepts: BOOL, effect: false },
  { name: 'net.ipv6.conf.all.disable_ipv6', value: '0', accepts: BOOL, effect: false },
  { name: 'net.ipv6.conf.all.forwarding', value: '0', accepts: BOOL, effect: false },
  { name: 'net.netfilter.nf_conntrack_max', value: '4096', accepts: 'int', effect: false },
  { name: 'vm.swappiness', value: '60', accepts: 'int', effect: false },
];

/** `net/ipv4/ip_forward` (a /proc/sys path) or `net/ipv4/ip_forward` typed with slashes → dotted name. */
export function sysctlName(text: string): string {
  return text.replace(/^\/proc\/sys\//, '').replace(/\//g, '.');
}

export function sysctlPath(name: string): string {
  return `/proc/sys/${name.replace(/\./g, '/')}`;
}

/** Keys that mirror each other (ip_forward and conf.all.forwarding are the same switch). */
const MIRRORS: Readonly<Record<string, string>> = {
  'net.ipv4.ip_forward': 'net.ipv4.conf.all.forwarding',
  'net.ipv4.conf.all.forwarding': 'net.ipv4.ip_forward',
};

const MAX_TEXT = 64;

export class Sysctl {
  private readonly values = new Map<string, string>(SYSCTL_KEYS.map((k) => [k.name, k.value]));
  private readonly listeners = new Set<(name: string, value: string) => void>();
  /** kernel.hostname reads the running name of the host. */
  private readonly hostname: { get(): string; set(name: string): string | null };

  constructor(hostname: { get(): string; set(name: string): string | null }) {
    this.hostname = hostname;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  get(name: string): string | undefined {
    return name === 'kernel.hostname' ? this.hostname.get() : this.values.get(name);
  }

  /** All keys, sorted (sysctl -a). */
  names(): string[] {
    return [...this.values.keys()].sort();
  }

  enabled(name: string): boolean {
    return this.get(name) === '1';
  }

  /** Sets a value; returns 'unknown', 'invalid' or null when applied. */
  set(name: string, raw: string): 'unknown' | 'invalid' | null {
    const key = SYSCTL_KEYS.find((k) => k.name === name);
    if (!key) return 'unknown';
    const value = raw.trim();
    if (key.accepts === 'int' ? !/^\d{1,9}$/.test(value) : key.accepts === 'text' ? value.length === 0 || value.length > MAX_TEXT : !key.accepts.includes(value)) return 'invalid';
    if (name === 'kernel.hostname') return this.hostname.set(value) ? 'invalid' : null;
    this.values.set(name, value);
    const mirror = MIRRORS[name];
    if (mirror) this.values.set(mirror, value);
    for (const l of this.listeners) l(name, value);
    return null;
  }

  onChange(listener: (name: string, value: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Boot: back to the defaults (before /etc/sysctl.conf is applied). */
  reset(): void {
    for (const k of SYSCTL_KEYS) if (k.name !== 'kernel.hostname') this.values.set(k.name, k.value);
    for (const l of this.listeners) l('*', '');
  }
}

/** `key = value` lines of a sysctl.conf file (comments with # or ;, `-key` ignores errors). */
export function parseSysctlConf(text: string): { key: string; value: string; quiet: boolean; line: number }[] {
  return text.split('\n').flatMap((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return [];
    const m = /^(-?)([\w./-]+)\s*=\s*(.*)$/.exec(line);
    return m ? [{ key: sysctlName(m[2] ?? ''), value: (m[3] ?? '').trim(), quiet: m[1] === '-', line: i + 1 }] : [];
  });
}
