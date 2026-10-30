/**
 * Areas of the labs: private networks, the Internet, DMZ, guests, servers, VLANs and VPN tunnels drawn around
 * the devices that belong to them (computed from their positions, so they follow the layout). Texts are in
 * the interface language when the lab is loaded.
 */
import type { Topology } from './topology.ts';
import type { Point } from './annotations.ts';
import { t } from '../i18n/t.ts';

const COLOR = {
  internet: '#455a64', lan: '#388e3c', lan2: '#0097a7', dmz: '#f57c00', guests: '#7b1fa2', servers: '#1976d2', external: '#455a64', tunnel: '#d32f2f',
} as const;
const PAD_X = 70;
/** Room above the devices (model line, then the interface name and address of an incoming cable) for the area name. */
const PAD_TOP = 132;
const PAD_BOTTOM = 66;
const MIN_COORD = 4;
const AREA_TEXT = 14;
const CHAR_W = 7.6;
/** Inner margin of the area name (same as the drawing layer). */
const LABEL_PAD = 8;

function centres(topo: Topology, labels: readonly string[]): Point[] | null {
  const pts = labels.map((l) => [...topo.placed.values()].find((p) => p.label === l));
  return pts.every((p) => p) ? pts.map((p) => ({ x: p?.x ?? 0, y: p?.y ?? 0 })) : null;
}

/** A named, lightly filled rectangle around some devices (nothing if one of them is missing). */
function area(topo: Topology, labels: readonly string[], color: string, text: string): void {
  const pts = centres(topo, labels);
  if (!pts) return;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const a = { x: Math.max(MIN_COORD, Math.min(...xs) - PAD_X), y: Math.max(MIN_COORD, Math.min(...ys) - PAD_TOP) };
  // Wide enough for its name (written in the top-left corner).
  const b = { x: Math.max(Math.max(...xs) + PAD_X, a.x + text.length * CHAR_W + 2 * LABEL_PAD), y: Math.max(...ys) + PAD_BOTTOM };
  topo.addAnnotation({ kind: 'rect', points: [a, b], color, fill: true, width: 2, text, size: AREA_TEXT });
}

/** A tunnel: a line between two routers with its name over the middle. */
function tunnel(topo: Topology, from: string, to: string, text: string): void {
  const pts = centres(topo, [from, to]);
  if (!pts) return;
  const [a, b] = pts as [Point, Point];
  topo.addAnnotation({ kind: 'line', points: [a, b], color: COLOR.tunnel, fill: false, width: 3 });
  const mid = { x: (a.x + b.x) / 2 - (text.length * CHAR_W) / 2, y: (a.y + b.y) / 2 - 14 };
  topo.addAnnotation({ kind: 'text', points: [mid], color: COLOR.tunnel, fill: false, width: 1, text, size: AREA_TEXT });
}

const lan = (name: string, net: string): string => t('area.lan', { name, net });
const internet = (topo: Topology, clouds: readonly string[]): void => area(topo, clouds, COLOR.internet, t('area.internet'));

const LAB_AREAS: Readonly<Record<string, (topo: Topology) => void>> = {
  basico: (o) => area(o, ['Switch0', 'PC0', 'PC1', 'PC2'], COLOR.lan, lan(t('area.name.lan'), '192.168.10.0/24')),
  reservas: (o) => area(o, ['Switch0', 'PC0', 'PC1', 'PC2'], COLOR.lan, lan(t('area.name.lan'), '192.168.10.0/24')),
  relay: (o) => area(o, ['Switch0', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.remote'), '10.20.0.0/24')),
  vlans: (o) => {
    area(o, ['PC0', 'PC1'], COLOR.lan, t('area.vlan', { id: '10', net: '172.16.10.0/24' }));
    area(o, ['PC2', 'PC3'], COLOR.lan2, t('area.vlan', { id: '20', net: '172.16.20.0/24' }));
  },
  // The rogue DHCP server (ROGUE, 192.168.10.66) is inside: it shares the broadcast domain, which is the point.
  snooping: (o) => area(o, ['SW', 'PC0', 'PC1', 'ROGUE'], COLOR.lan, lan(t('area.name.lan'), '192.168.10.0/24')),
  servidores: (o) => area(o, ['Switch0', 'SRV', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.classroom'), '192.168.10.0/24')),
  internet: (o) => {
    internet(o, ['ISP-Norte', 'ISP-Sur']);
    area(o, ['Switch0', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.site', { n: '1' }), '192.168.10.0/24'));
    area(o, ['Switch1', 'SRV-SEDE2', 'PC2'], COLOR.lan2, lan(t('area.name.site', { n: '2' }), '192.168.1.0/24'));
  },
  'vpn-ipsec': (o) => {
    internet(o, ['ISP-Norte', 'ISP-Sur']);
    area(o, ['Switch0', 'PC0', 'PC1'], COLOR.lan, lan('SEDE-A', '192.168.10.0/24'));
    area(o, ['Switch1', 'PC2', 'PC3'], COLOR.lan2, lan('SEDE-B', '192.168.20.0/24'));
    tunnel(o, 'SEDE-A', 'SEDE-B', t('area.tunnel', { kind: 'IPsec', net: '192.168.10.0/24 ↔ 192.168.20.0/24' }));
  },
  'vpn-wireguard': (o) => {
    internet(o, ['ISP-Norte', 'ISP-Sur']);
    area(o, ['Switch0', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.hq'), '10.1.0.0/24'));
    area(o, ['Switch1', 'PC2', 'PC3'], COLOR.lan2, lan(t('area.name.branch'), '10.2.0.0/24'));
    tunnel(o, 'CENTRAL', 'SUCURSAL', t('area.tunnel', { kind: 'WireGuard', net: 'wg0 10.99.0.0/24' }));
  },
  'linux-dmz': (o) => {
    internet(o, ['ISP-Norte', 'ISP-Sur']);
    area(o, ['Switch0', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.lan'), '192.168.1.0/24'));
    area(o, ['WEB-DMZ'], COLOR.dmz, t('area.dmz', { net: '172.16.0.0/24' }));
    area(o, ['CLIENTE-EXT'], COLOR.external, t('area.external'));
  },
  'dns-reenvio': (o) => {
    internet(o, ['ISP-Norte']);
    area(o, ['Switch0', 'PC0', 'PC1', 'NS1'], COLOR.lan, lan(t('area.name.company'), '192.168.50.0/24'));
    area(o, ['INVITADO'], COLOR.guests, t('area.guests', { net: '192.168.60.0/24' }));
  },
  'nombres-lan': (o) => {
    internet(o, ['ISP-Norte']);
    area(o, ['Switch0', 'WIN1', 'WIN2', 'LNX1', 'LNX2'], COLOR.lan, lan(t('area.name.lan'), '192.168.1.0/24'));
  },
  'nombres-redes': (o) => {
    area(o, ['SW-A', 'SRV', 'WIN-A'], COLOR.lan, lan('LAN A', '192.168.10.0/24'));
    area(o, ['SW-B', 'WIN-B', 'WIN-B2'], COLOR.lan2, lan('LAN B', '192.168.20.0/24'));
  },
  'ssh-sftp': (o) => area(o, ['Switch0', 'SRV', 'PC0', 'PC1'], COLOR.lan, lan(t('area.name.classroom'), '172.20.0.0/24')),
  bastionado: (o) => {
    area(o, ['Switch0', 'ADMIN'], COLOR.lan, t('area.admin', { net: '192.168.10.0/24' }));
    area(o, ['SRV-INTRANET'], COLOR.servers, t('area.servers', { net: '172.20.0.0/24' }));
    area(o, ['Switch1', 'ALUMNO'], COLOR.guests, t('area.students', { net: '192.168.20.0/24' }));
  },
};

/**
 * Longer cables for the labs whose interface labels (name and address at each end) would otherwise meet: the layout
 * is stretched from its top-left device, horizontally and vertically (tests/ui/lab-labels.test.ts keeps them apart).
 */
const LAB_SPREAD: Readonly<Record<string, readonly [number, number]>> = {
  basico: [1, 1.2], reservas: [1, 1.2], snooping: [1, 1.2], relay: [1, 1.3], vlans: [1, 1.1], servidores: [1, 1.3], internet: [1, 1.4], 'vpn-ipsec': [1, 1.4], 'vpn-wireguard': [1, 1.4], 'linux-dmz': [1.3, 1.4], 'dns-reenvio': [1, 1.5], 'nombres-lan': [1, 1.4], 'nombres-redes': [1.2, 1.5],
};

function spread(id: string, topo: Topology): void {
  const factor = LAB_SPREAD[id];
  if (!factor) return;
  const placed = [...topo.placed.values()];
  const x0 = Math.min(...placed.map((p) => p.x));
  const y0 = Math.min(...placed.map((p) => p.y));
  for (const p of placed) {
    p.x = Math.round(x0 + (p.x - x0) * factor[0]);
    p.y = Math.round(y0 + (p.y - y0) * factor[1]);
  }
}

/** The lab with its cables stretched where needed and its areas drawn. */
export function decorateLab(id: string, topo: Topology): Topology {
  spread(id, topo);
  LAB_AREAS[id]?.(topo);
  return topo;
}

/** Labs that have areas (for the tests). */
export const LABS_WITH_AREAS: readonly string[] = Object.keys(LAB_AREAS);
