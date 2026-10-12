/** Helpers to render `show running-config` sections. */
import type { IosDevice } from './device.ts';
import type { IfaceConfig } from './interfaces.ts';
import { isSubinterface, parseIfaceName } from './interfaces.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { userLines } from './http.ts';

export function headerLines(device: IosDevice, version: string): string[] {
  const lines = [
    '!',
    `version ${version}`,
    'no service timestamps log datetime msec',
    'no service timestamps debug datetime msec',
    'no service password-encryption',
    '!',
    `hostname ${device.hostname}`,
    '!',
  ];
  if (device.enableSecret) lines.push(`enable secret 5 ${device.enableSecret}`);
  if (device.enablePassword) lines.push(`enable password ${device.enablePassword}`);
  if (device.enableSecret || device.enablePassword) lines.push('!');
  lines.push(...userLines(device));
  return lines;
}

export function globalIpLines(device: IosDevice): string[] {
  const lines: string[] = [];
  if (!device.domainLookup) lines.push('no ip domain-lookup');
  if (device.domainName) lines.push(`ip domain-name ${device.domainName}`);
  if (device.nameServers.length > 0) lines.push(`ip name-server ${device.nameServers.map(formatIp).join(' ')}`);
  return lines;
}

function addressLines(cfg: IfaceConfig): string[] {
  if (cfg.dhcpClient) {
    const cid = cfg.dhcpClient.clientIdIface ? ` client-id ${cfg.dhcpClient.clientIdIface}` : '';
    const host = cfg.dhcpClient.hostname ? ` hostname ${cfg.dhcpClient.hostname}` : '';
    return [` ip address dhcp${cid}${host}`];
  }
  if (!cfg.address) return cfg.switchport ? [] : [' no ip address'];
  const sec = cfg.secondaries.map((s) => ` ip address ${formatIp(s.ip)} ${formatMask(s.prefix)} secondary`);
  return [...sec, ` ip address ${formatIp(cfg.address.ip)} ${formatMask(cfg.address.prefix)}`];
}

function switchportLines(cfg: IfaceConfig): string[] {
  const lines: string[] = [];
  if (cfg.accessVlan !== 1) lines.push(` switchport access vlan ${cfg.accessVlan}`);
  if (cfg.nativeVlan !== 1) lines.push(` switchport trunk native vlan ${cfg.nativeVlan}`);
  if (cfg.switchportMode !== 'dynamic auto') lines.push(` switchport mode ${cfg.switchportMode}`);
  return lines;
}

function isPhysical(name: string): boolean {
  const type = parseIfaceName(name)?.type;
  return !isSubinterface(name) && type !== 'Vlan' && type !== 'Loopback';
}

export function interfaceBlock(cfg: IfaceConfig, extra: readonly string[] = []): string[] {
  const lines = [`interface ${cfg.name}`];
  if (cfg.description) lines.push(` description ${cfg.description}`);
  if (cfg.encapsulationVlan !== undefined) lines.push(` encapsulation dot1Q ${cfg.encapsulationVlan}`);
  if (cfg.switchport) lines.push(...switchportLines(cfg));
  else lines.push(...addressLines(cfg));
  for (const h of cfg.helpers) lines.push(` ip helper-address ${formatIp(h)}`);
  if (cfg.relayInfoTrusted) lines.push(' ip dhcp relay information trusted');
  lines.push(...extra);
  if (cfg.switchport) {
    if (cfg.duplex) lines.push(` duplex ${cfg.duplex}`);
    if (cfg.speed) lines.push(` speed ${cfg.speed}`);
  } else if (isPhysical(cfg.name) && parseIfaceName(cfg.name)?.type !== 'Serial') {
    lines.push(` duplex ${cfg.duplex ?? 'auto'}`, ` speed ${cfg.speed ?? 'auto'}`);
  }
  if (cfg.shutdown) lines.push(' shutdown');
  lines.push('!');
  return lines;
}

export function interfaceSection(device: IosDevice, extra: (name: string) => string[] = () => []): string[] {
  return device.sortedIfaceNames().flatMap((n) => {
    const cfg = device.iface(n);
    return cfg ? interfaceBlock(cfg, extra(n)) : [];
  });
}

export function trailerLines(device: IosDevice): string[] {
  const lines: string[] = [];
  if (device.bannerMotd !== undefined) lines.push(`banner motd ^C${device.bannerMotd}^C`, '!');
  return [...lines, '!', '!', 'line con 0', '!', 'line aux 0', '!', 'line vty 0 4', ' login', '!', '!', '!', 'end'];
}
