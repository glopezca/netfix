/**
 * Kernel files of an Ubuntu host: /proc/sys (read and write the live sysctl values), /etc/sysctl.conf,
 * /etc/sysctl.d and /etc/nftables.conf, and the "boot" that applies them when a topology is opened.
 */
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';
import { FsError } from '../bash/vfs.ts';
import { SYSCTL_KEYS, parseSysctlConf, sysctlPath } from '../net/sysctl.ts';
import { DEFAULT_NFTABLES_CONF, NFTABLES_CONF } from '../devices/server-firewall.ts';

export const SYSCTL_CONF = '/etc/sysctl.conf';
export const SYSCTL_DIR = '/etc/sysctl.d';
/** Where the Server window and the web GUI save kernel parameters. */
export const NETFIX_SYSCTL = '/etc/sysctl.d/99-netfix.conf';

const DEFAULT_SYSCTL_CONF = `#
# /etc/sysctl.conf - Configuration file for setting system variables
# See /etc/sysctl.d/ for additional system variables.
# See sysctl.conf (5) for information.
#

#kernel.domainname = example.com

###################################################################
# Functions previously found in netbase
#

# Uncomment the next two lines to enable Spoof protection (reverse-path filter)
# Turn on Source Address Verification in all interfaces to
# prevent some spoofing attacks
#net.ipv4.conf.default.rp_filter=1
#net.ipv4.conf.all.rp_filter=1

# Uncomment the next line to enable TCP/IP SYN cookies
# See http://lwn.net/Articles/277146/
# Note: This may impact IPv6 TCP sessions too
#net.ipv4.tcp_syncookies=1

# Uncomment the next line to enable packet forwarding for IPv4
#net.ipv4.ip_forward=1

# Uncomment the next line to enable packet forwarding for IPv6
#  Enabling this option disables Stateless Address Autoconfiguration
#  based on Router Advertisements for this host
#net.ipv6.conf.all.forwarding=1

###################################################################
# Additional settings - these settings can improve the network
# security of the host and prevent against some network attacks
# including spoofing attacks and man in the middle attacks through
# redirection. Some network environments, however, require that these
# settings are disabled so review and enable them as needed.
#
# Do not accept ICMP redirects (prevent MITM attacks)
#net.ipv4.conf.all.accept_redirects = 0
#net.ipv6.conf.all.accept_redirects = 0
# _or_
# Accept ICMP redirects only for gateways listed in our default
# gateway list (enabled by default)
# net.ipv4.conf.all.secure_redirects = 1
#
# Do not send ICMP redirects (we are not a router)
#net.ipv4.conf.all.send_redirects = 0
#
# Do not accept IP source route packets (we are not a router)
#net.ipv4.conf.all.accept_source_route = 0
#net.ipv6.conf.all.accept_source_route = 0
#
# Log Martian Packets
#net.ipv4.conf.all.log_martians = 1
#

###################################################################
# Magic system request Key
# 0=disable, 1=enable all, >1 bitmask of sysrq functions
# See https://www.kernel.org/doc/html/latest/admin-guide/sysrq.html
# for what other values do
#kernel.sysrq=438
`;

const NETWORK_SECURITY = `
# Turn on Source Address Verification in all interfaces to
# prevent some spoofing attacks.
net.ipv4.conf.default.rp_filter=2
net.ipv4.conf.all.rp_filter=2
`;

const README = `Kernel system variables configuration files

Files found under the /etc/sysctl.d directory that end with .conf are
parsed within sysctl(8) at boot time.  If you want to set kernel variables
you can either edit /etc/sysctl.conf or make a new file.

The filename isn't important, but don't make it a package name as it may clash
with something the package builder needs later. It must end with .conf though.

My personal preference would be for local system settings to go into
/etc/sysctl.d/local.conf but as long as you follow the rules for the names
of the file, anything will work. See sysctl.conf(8) man page for details
of the format.

After making any changes, please run "service procps force-reload" (or, from
a Debian package maintainer script "deb-systemd-invoke restart procps.service").
`;

/** Seeds the configuration files and mounts /proc/sys on the live parameters. */
export function seedKernel(fs: Vfs, host: Host): void {
  fs.seed(SYSCTL_CONF, { kind: 'file', content: DEFAULT_SYSCTL_CONF }, 0o644);
  fs.seed(SYSCTL_DIR, { kind: 'dir' }, 0o755);
  fs.seed(`${SYSCTL_DIR}/10-network-security.conf`, { kind: 'file', content: NETWORK_SECURITY }, 0o644);
  fs.seed(`${SYSCTL_DIR}/README.sysctl`, { kind: 'file', content: README }, 0o644);
  fs.seed(NFTABLES_CONF, { kind: 'file', content: DEFAULT_NFTABLES_CONF }, 0o755);
  // wireguard-tools creates /etc/wireguard readable by root only.
  if (host.kind === 'linuxrouter') fs.seed('/etc/wireguard', { kind: 'dir' }, 0o700);
  const sysctl = host.kernel.sysctl;
  for (const key of SYSCTL_KEYS) {
    fs.mountFile(sysctlPath(key.name), () => `${sysctl.get(key.name) ?? ''}\n`, 0o644, (content) => {
      // A redirection truncates and then appends (old value + new one): the last line is what was written.
      const value = content.split('\n').filter((l) => l.trim() !== '').at(-1) ?? '';
      if (value !== '' && sysctl.set(key.name, value) !== null) throw new FsError('EINVAL');
    });
  }
}

/** The files `sysctl --system` reads, in order: /etc/sysctl.d/*.conf, then /etc/sysctl.conf. */
export function sysctlFiles(fs: Vfs): string[] {
  const dir = fs.tryLookup(SYSCTL_DIR)?.kind === 'dir' ? fs.readdir(SYSCTL_DIR).filter((n) => n.endsWith('.conf')).sort().map((n) => `${SYSCTL_DIR}/${n}`) : [];
  return [...dir, ...(fs.tryLookup(SYSCTL_CONF)?.kind === 'file' ? [SYSCTL_CONF] : [])];
}

/** Applies a sysctl.conf file; returns the applied `key = value` lines and the errors. */
export function applySysctlFile(fs: Vfs, host: Host, path: string): { applied: string[]; errors: string[] } {
  const applied: string[] = [];
  const errors: string[] = [];
  const text = fs.tryLookup(path)?.kind === 'file' ? fs.readFile(path) : null;
  if (text === null) return { applied, errors: [`sysctl: cannot open "${path}": No such file or directory`] };
  for (const e of parseSysctlConf(text)) {
    const r = host.kernel.sysctl.set(e.key, e.value);
    if (r === null) applied.push(`${e.key} = ${host.kernel.sysctl.get(e.key) ?? e.value}`);
    else if (!e.quiet) errors.push(r === 'unknown' ? `sysctl: cannot stat ${sysctlPath(e.key)}: No such file or directory` : `sysctl: setting key "${e.key}": Invalid argument`);
  }
  return { applied, errors };
}
