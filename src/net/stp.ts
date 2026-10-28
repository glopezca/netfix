/**
 * Spanning tree (IEEE 802.1D) per VLAN, as PVST+ runs it: the converged result, computed from the switches and the
 * cables between them. The root is the lowest bridge ID (priority + VLAN, then MAC); each other bridge keeps the port
 * with the best root priority vector {root, cost, sender bridge, sender port, own port}; on each link the end with the
 * best designated vector {root, cost, bridge, port} is designated, and a port that is neither blocks (alternate).
 */

export interface StpEndpoint {
  readonly device: string;
  readonly port: string;
}

/** A switch port that is up, with the VLANs it carries (its access VLAN, or every VLAN of a trunk). */
export interface StpPort {
  readonly name: string;
  /** Port number of the port ID (Fa0/1 = 1 … Gi0/2 = 26). */
  readonly number: number;
  readonly cost: number;
  readonly priority: number;
  /** `spanning-tree portfast`. */
  readonly edge: boolean;
  readonly vlans: readonly number[];
}

export interface StpBridge {
  readonly id: string;
  readonly mac: string;
  /** Configured bridge priority for a VLAN (32768 by default), or null with `no spanning-tree vlan`. */
  readonly priority: (vlan: number) => number | null;
  readonly ports: readonly StpPort[];
}

export interface StpLink {
  readonly a: StpEndpoint;
  readonly b: StpEndpoint;
}

export interface BridgeId {
  /** Priority plus the VLAN number (extend system-id). */
  readonly priority: number;
  readonly mac: string;
}

export type StpRole = 'Root' | 'Desg' | 'Altn';

export interface StpPortState {
  readonly role: StpRole;
  readonly forwarding: boolean;
  readonly cost: number;
  readonly priority: number;
  readonly number: number;
  readonly edge: boolean;
}

export interface StpVlan {
  readonly root: BridgeId;
  readonly bridge: BridgeId;
  /** Root path cost. */
  readonly cost: number;
  readonly rootPort?: string;
  readonly ports: ReadonlyMap<string, StpPortState>;
}

/** Device id → VLAN → state, for the bridges and VLANs where spanning tree runs. */
export type StpResult = ReadonlyMap<string, ReadonlyMap<number, StpVlan>>;

/** {root, cost, designated bridge, designated port, receiving port}: lower is better, field by field. */
type Vector = readonly [BridgeId, number, BridgeId, number, number];

function compareId(a: BridgeId, b: BridgeId): number {
  return a.priority - b.priority || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0);
}

function compare(a: Vector, b: Vector): number {
  return compareId(a[0], b[0]) || a[1] - b[1] || compareId(a[2], b[2]) || a[3] - b[3] || a[4] - b[4];
}

const portId = (p: StpPort): number => p.priority * 4096 + p.number;

interface Member {
  readonly bridge: StpBridge;
  readonly id: BridgeId;
  readonly ports: readonly StpPort[];
}

interface Neighbour {
  readonly port: StpPort;
  readonly peer: Member;
  readonly peerPort: StpPort;
}

/** The bridges running spanning tree for `vlan`, with their ports in it. */
function members(bridges: readonly StpBridge[], vlan: number): Map<string, Member> {
  const out = new Map<string, Member>();
  for (const b of bridges) {
    const prio = b.priority(vlan);
    const ports = b.ports.filter((p) => p.vlans.includes(vlan));
    if (prio === null || ports.length === 0) continue;
    out.set(b.id, { bridge: b, id: { priority: prio + vlan, mac: b.mac }, ports });
  }
  return out;
}

function neighbours(m: Map<string, Member>, links: readonly StpLink[]): Map<string, Neighbour[]> {
  const out = new Map<string, Neighbour[]>([...m.keys()].map((k) => [k, []]));
  const portOf = (e: StpEndpoint): StpPort | undefined => m.get(e.device)?.ports.find((p) => p.name === e.port);
  for (const l of links) {
    const [pa, pb, ma, mb] = [portOf(l.a), portOf(l.b), m.get(l.a.device), m.get(l.b.device)];
    if (!pa || !pb || !ma || !mb) continue;
    out.get(l.a.device)?.push({ port: pa, peer: mb, peerPort: pb });
    out.get(l.b.device)?.push({ port: pb, peer: ma, peerPort: pa });
  }
  return out;
}

/** Each bridge's best root vector, by relaxing the vectors its neighbours advertise until nothing changes. */
function rootVectors(m: Map<string, Member>, nb: Map<string, Neighbour[]>): Map<string, Vector> {
  const best = new Map<string, Vector>([...m].map(([k, b]) => [k, [b.id, 0, b.id, 0, 0] as Vector]));
  for (let round = 0; round <= m.size; round++) {
    let changed = false;
    for (const [k, list] of nb) {
      for (const n of list) {
        const theirs = best.get(n.peer.bridge.id);
        const mine = best.get(k);
        if (!theirs || !mine) continue;
        const offer: Vector = [theirs[0], theirs[1] + n.port.cost, n.peer.id, portId(n.peerPort), portId(n.port)];
        if (compare(offer, mine) < 0) {
          best.set(k, offer);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return best;
}

/** The port's end of its link advertises a better vector than the far end (or there is no bridge there). */
function isDesignated(mine: Vector, member: Member, p: StpPort, n: Neighbour | undefined, best: Map<string, Vector>): boolean {
  const theirs = n ? best.get(n.peer.bridge.id) : undefined;
  if (!n || !theirs) return true;
  return compare([mine[0], mine[1], member.id, portId(p), 0], [theirs[0], theirs[1], n.peer.id, portId(n.peerPort), 0]) < 0;
}

function vlanTree(m: Map<string, Member>, links: readonly StpLink[]): Map<string, StpVlan> {
  const nb = neighbours(m, links);
  const best = rootVectors(m, nb);
  const out = new Map<string, StpVlan>();
  for (const [k, member] of m) {
    const v = best.get(k);
    if (!v) continue;
    const isRoot = compareId(v[0], member.id) === 0;
    const rootPort = isRoot ? undefined : member.ports.find((p) => portId(p) === v[4])?.name;
    const ports = new Map<string, StpPortState>();
    for (const p of member.ports) {
      const designated = isDesignated(v, member, p, nb.get(k)?.find((x) => x.port === p), best);
      const role: StpRole = p.name === rootPort ? 'Root' : designated ? 'Desg' : 'Altn';
      ports.set(p.name, { role, forwarding: role !== 'Altn', cost: p.cost, priority: p.priority, number: p.number, edge: p.edge });
    }
    out.set(k, { root: v[0], bridge: member.id, cost: v[1], ...(rootPort ? { rootPort } : {}), ports });
  }
  return out;
}

export function computeStp(bridges: readonly StpBridge[], links: readonly StpLink[]): StpResult {
  const vlans = new Set(bridges.flatMap((b) => b.ports.flatMap((p) => p.vlans)));
  const out = new Map<string, Map<number, StpVlan>>();
  for (const vlan of [...vlans].sort((a, b) => a - b)) {
    for (const [k, state] of vlanTree(members(bridges, vlan), links)) {
      const per = out.get(k) ?? new Map<number, StpVlan>();
      per.set(vlan, state);
      out.set(k, per);
    }
  }
  return out;
}

/** Per VLAN, the forwarding ports of every bridge: what changes when the tree changes (a topology change). */
export function forwardingKeys(tree: StpResult): Map<number, string> {
  const out = new Map<number, string>();
  for (const [device, vlans] of tree) {
    for (const [vlan, s] of vlans) {
      const fwd = [...s.ports].filter(([, p]) => p.forwarding).map(([n]) => n).join(',');
      out.set(vlan, `${out.get(vlan) ?? ''}${device}:${fwd};`);
    }
  }
  return out;
}
