/**
 * The fictitious package catalogue of apt (Ubuntu 26.04 «resolute», always up to date): the service packages, each with
 * the dependencies it brings and the device switch it turns on (lab-features.ts), and the base system, which is always
 * installed and cannot be removed. Versions follow what the simulated programs report (Apache 2.4.62, BIND 9.20.4…).
 */
import type { FeatureId } from '../net/lab-features.ts';

export interface AptDep {
  readonly name: string;
  readonly version: string;
  readonly arch: 'amd64' | 'all';
  /** Download size (kB). */
  readonly kb: number;
}

export interface AptPackage extends AptDep {
  readonly section: 'main' | 'universe';
  readonly deps: readonly AptDep[];
  /** The panel it brings on a Server or Linux router. */
  readonly feature?: FeatureId;
  /** systemd unit enabled when it is set up. */
  readonly unit?: string;
}

const dep = (name: string, version: string, kb: number, arch: 'amd64' | 'all' = 'amd64'): AptDep => ({ name, version, kb, arch });

const SSH_VERSION = '1:10.0p2-5ubuntu2';
const OPENSSH: readonly AptDep[] = [dep('openssh-sftp-server', SSH_VERSION, 38), dep('ncurses-term', '6.5+20250216-2', 275, 'all'), dep('ssh-import-id', '5.11-0ubuntu3', 10, 'all')];
const KEA: readonly AptDep[] = [dep('kea-common', '2.6.3-1ubuntu1', 85, 'all'), dep('libkea-dhcpsrv62', '2.6.3-1ubuntu1', 1243), dep('libkea-asiolink56', '2.6.3-1ubuntu1', 98), dep('libkea-log61', '2.6.3-1ubuntu1', 41)];
const DOVECOT: readonly AptDep[] = [dep('dovecot-core', '1:2.4.1+dfsg1-6ubuntu1', 3511), dep('libexttextcat-2.0-0', '3.4.7-1', 14)];

export const PACKAGES: readonly AptPackage[] = [
  { ...dep('openssh-server', SSH_VERSION, 549), section: 'main', deps: OPENSSH, feature: 'ssh', unit: 'ssh' },
  { ...dep('ssh', SSH_VERSION, 3, 'all'), section: 'main', deps: [dep('openssh-server', SSH_VERSION, 549), ...OPENSSH], feature: 'ssh', unit: 'ssh' },
  { ...dep('kea-dhcp4-server', '2.6.3-1ubuntu1', 432), section: 'main', deps: KEA, feature: 'dhcp', unit: 'kea-dhcp4-server' },
  { ...dep('kea', '2.6.3-1ubuntu1', 3, 'all'), section: 'main', deps: [dep('kea-dhcp4-server', '2.6.3-1ubuntu1', 432), ...KEA], feature: 'dhcp', unit: 'kea-dhcp4-server' },
  { ...dep('bind9', '1:9.20.4-3ubuntu1', 260), section: 'main', deps: [dep('bind9-utils', '1:9.20.4-3ubuntu1', 189), dep('bind9-libs', '1:9.20.4-3ubuntu1', 1452), dep('dns-root-data', '2024071801', 6, 'all')], feature: 'dns', unit: 'named' },
  { ...dep('apache2', '2.4.62-1ubuntu1', 90), section: 'main', deps: [dep('apache2-bin', '2.4.62-1ubuntu1', 1370), dep('apache2-data', '2.4.62-1ubuntu1', 160, 'all'), dep('apache2-utils', '2.4.62-1ubuntu1', 96), dep('libapr1t64', '1.7.5-1', 107), dep('libaprutil1t64', '1.6.3-3ubuntu1', 92), dep('ssl-cert', '1.1.3ubuntu1', 17, 'all')], feature: 'http', unit: 'apache2' },
  { ...dep('postfix', '3.10.2-1ubuntu1', 1305), section: 'main', deps: [dep('ssl-cert', '1.1.3ubuntu1', 17, 'all')], feature: 'mail', unit: 'postfix' },
  { ...dep('dovecot-imapd', '1:2.4.1+dfsg1-6ubuntu1', 214), section: 'main', deps: DOVECOT, feature: 'mail', unit: 'dovecot' },
  { ...dep('dovecot-pop3d', '1:2.4.1+dfsg1-6ubuntu1', 181), section: 'main', deps: DOVECOT, feature: 'mail', unit: 'dovecot' },
  { ...dep('nftables', '1.1.1-1build1', 70), section: 'main', deps: [dep('libnftables1', '1.1.1-1build1', 364), dep('libnftnl11', '1.2.8-1', 66)], feature: 'firewall' },
  { ...dep('wireguard-tools', '1.0.20250521-1', 89), section: 'main', deps: [], feature: 'vpn' },
  { ...dep('wireguard', '1.0.20250521-1', 3, 'all'), section: 'main', deps: [dep('wireguard-tools', '1.0.20250521-1', 89)], feature: 'vpn' },
  { ...dep('rsyslog', '8.2412.0-2ubuntu2', 538), section: 'main', deps: [dep('liblognorm5', '2.0.6-4build1', 63), dep('libestr0', '0.1.11-1build1', 8)], feature: 'log', unit: 'rsyslog' },
  // Any GNU/Linux host (PC too): tools rather than service panels (host-packages.ts keeps them).
  { ...dep('network-manager', '1.54.0-1ubuntu1', 3412), section: 'main', deps: [dep('libnm0', '1.54.0-1ubuntu1', 498), dep('libndp0', '1.9-1', 12), dep('libteamdctl0', '1.31-1build4', 13)], unit: 'NetworkManager' },
  { ...dep('avahi-daemon', '0.8-16ubuntu2', 85), section: 'main', deps: [dep('libavahi-common3', '0.8-16ubuntu2', 23), dep('libavahi-core7', '0.8-16ubuntu2', 82), dep('libdaemon0', '0.14-7.1ubuntu4', 15), dep('libnss-mdns', '0.15.1-4build2', 27)], unit: 'avahi-daemon' },
  { ...dep('libnss-mdns', '0.15.1-4build2', 27), section: 'main', deps: [] },
];

/** Always installed: `install` says they are up to date, `remove` refuses. */
export const BASE: Readonly<Record<string, string>> = {
  apt: '3.1.6ubuntu2', bash: '5.3-1ubuntu1', coreutils: '9.7-3ubuntu1', dpkg: '1.22.21ubuntu3', sudo: '1.9.17p2-1ubuntu1', systemd: '258.1-1ubuntu1',
  'openssh-client': SSH_VERSION, curl: '8.14.1-2ubuntu1', wget: '1.25.0-2ubuntu1', nano: '8.4-1', vim: '2:9.1.1230-2ubuntu1', mc: '3:4.8.33-1',
  iproute2: '6.14.0-1ubuntu1', 'iputils-ping': '3:20240905-3ubuntu1', 'bind9-dnsutils': '1:9.20.4-3ubuntu1', 'netplan.io': '1.1.2-6ubuntu1', less: '668-1',
};

export function findPackage(name: string): AptPackage | undefined {
  return PACKAGES.find((p) => p.name === name);
}

/** "1,234" as apt writes sizes. */
export function kb(n: number): string {
  return n.toLocaleString('en-US');
}
