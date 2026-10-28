/** `show ip interface brief` and `show interfaces`. */
import type { IosDevice } from '../device.ts';
import type { IfaceConfig } from '../interfaces.ts';
import { parseIfaceName } from '../interfaces.ts';
import { formatIp, formatMask } from '../../core/ip.ts';
import { formatMacCisco } from '../../core/mac.ts';

export interface IfaceAddress {
  readonly ip?: number;
  readonly prefix?: number;
  readonly method: 'manual' | 'DHCP' | 'unset' | 'NVRAM';
}

/** Address actually in use: static config or DHCP-learned (provided by the device). */
export function effectiveAddress(device: IosDevice, cfg: IfaceConfig): IfaceAddress {
  const learned = device.dhcpLearned(cfg.name);
  if (cfg.dhcpClient) return learned ? { ...learned, method: 'DHCP' } : { method: 'DHCP' };
  if (cfg.address) return { ip: cfg.address.ip, prefix: cfg.address.prefix, method: 'manual' };
  return { method: 'unset' };
}

export function ifaceStatus(device: IosDevice, cfg: IfaceConfig): { status: string; protocol: string } {
  if (cfg.shutdown) return { status: 'administratively down', protocol: 'down' };
  const rt = device.ifaceRuntime(cfg.name);
  if (rt.errDisabled) return { status: 'down', protocol: 'down (err-disabled)' };
  return { status: rt.linkUp ? 'up' : 'down', protocol: rt.protocolUp ? 'up' : 'down' };
}

export function showIpInterfaceBrief(device: IosDevice): string[] {
  const header = 'Interface              IP-Address      OK? Method Status                Protocol ';
  const rows = device.sortedIfaceNames().map((name) => {
    const cfg = device.iface(name);
    if (!cfg) return '';
    const addr = cfg.switchport ? { method: 'unset' as const } : effectiveAddress(device, cfg);
    const ip = addr.ip === undefined ? 'unassigned' : formatIp(addr.ip);
    const { status, protocol } = ifaceStatus(device, cfg);
    return `${name.padEnd(23)}${ip.padEnd(16)}YES ${addr.method.padEnd(7)}${status.padEnd(22)}${protocol} `;
  });
  return [header, ...rows];
}

function hardwareLine(device: IosDevice, cfg: IfaceConfig): string {
  const mac = formatMacCisco(device.ifaceRuntime(cfg.name).mac);
  const type = parseIfaceName(cfg.name)?.type ?? 'Ethernet';
  const hw = type === 'GigabitEthernet' ? 'CN Gigabit Ethernet' : type === 'Loopback' ? 'Loopback' : type === 'Vlan' ? 'CPU Interface' : 'Lance';
  return `  Hardware is ${hw}, address is ${mac} (bia ${mac})`;
}

function showOne(device: IosDevice, cfg: IfaceConfig): string[] {
  const { status, protocol } = ifaceStatus(device, cfg);
  const addr = effectiveAddress(device, cfg);
  const lines = [`${cfg.name} is ${status}, line protocol is ${protocol}`, hardwareLine(device, cfg)];
  if (cfg.description) lines.push(`  Description: ${cfg.description}`);
  if (addr.ip !== undefined && addr.prefix !== undefined) lines.push(`  Internet address is ${formatIp(addr.ip)}/${addr.prefix}`);
  lines.push('  MTU 1500 bytes, BW 1000000 Kbit, DLY 10 usec,', '     reliability 255/255, txload 1/255, rxload 1/255');
  if (cfg.encapsulationVlan !== undefined) lines.push(`  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${cfg.encapsulationVlan}`);
  else lines.push('  Encapsulation ARPA, loopback not set');
  return lines;
}

export function showInterfaces(device: IosDevice, filter?: string): string[] {
  if (filter) {
    const parsed = parseIfaceName(filter);
    const name = parsed ? device.resolveIface(parsed.full, false) : null;
    const cfg = name ? device.iface(name) : undefined;
    return cfg ? showOne(device, cfg) : ['%Invalid interface type and number'];
  }
  return device.sortedIfaceNames().flatMap((n) => {
    const cfg = device.iface(n);
    return cfg ? showOne(device, cfg) : [];
  });
}

export function maskText(prefix: number): string {
  return formatMask(prefix);
}
