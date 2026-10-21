/**
 * One step of iterative resolution (what bind does when it recurses without `forward only`): an answer from a
 * server asked with RD=0 is a final answer, a CNAME to follow, a referral to the servers of a closer zone (NS in the
 * authority section, their addresses as glue) or useless (lame: try the next server).
 */
import type { DnsAnswer, DnsMessage, DnsType } from '../net/packets.ts';
import { normalizeName } from '../net/dns.ts';
import { parseIp } from '../core/ip.ts';

export type IterStep =
  | { readonly kind: 'answer'; readonly msg: DnsMessage }
  | { readonly kind: 'cname'; readonly answers: readonly DnsAnswer[]; readonly target: string }
  | { readonly kind: 'referral'; readonly zone: string; readonly servers: readonly number[]; readonly names: readonly string[]; readonly ttl: number }
  | { readonly kind: 'lame' };

const inZone = (name: string, zone: string): boolean => zone === '' || name === zone || name.endsWith(`.${zone}`);

/** Classifies the answer of a server asked for `qname`/`qtype` while iterating. */
export function iterStep(msg: DnsMessage, qname: string, qtype: DnsType): IterStep {
  if (msg.rcode === 'NXDOMAIN') return { kind: 'answer', msg };
  if (msg.rcode !== 'NOERROR') return { kind: 'lame' };
  const answers = msg.answers ?? [];
  if (answers.length > 0) {
    const last = answers[answers.length - 1];
    const chased = answers.some((a) => a.type === qtype);
    if (last?.type === 'CNAME' && qtype !== 'CNAME' && !chased) return { kind: 'cname', answers, target: normalizeName(last.data) };
    return { kind: 'answer', msg };
  }
  const ns = (msg.authority ?? []).filter((a) => a.type === 'NS');
  if (ns.length === 0) return msg.authoritative ? { kind: 'answer', msg } : { kind: 'lame' };
  const zone = normalizeName(ns[0]?.name ?? '');
  if (!inZone(qname, zone)) return { kind: 'lame' };
  const names = ns.map((a) => normalizeName(a.data));
  const glue = (msg.additional ?? []).filter((a) => a.type === 'A' && names.includes(normalizeName(a.name)));
  const servers = glue.map((a) => parseIp(a.data)).filter((x): x is number => x !== null);
  return servers.length ? { kind: 'referral', zone, servers, names, ttl: Math.min(...ns.map((a) => a.ttl)) } : { kind: 'lame' };
}

/** The closest zone whose servers are known (cached delegations), or the root. */
export function closestServers(qname: string, delegations: ReadonlyMap<string, { servers: readonly number[]; expires: number }>, now: number, roots: readonly number[]): { zone: string; servers: readonly number[] } {
  const labels = normalizeName(qname).split('.');
  for (let i = 0; i < labels.length; i++) {
    const zone = labels.slice(i).join('.');
    const hit = delegations.get(zone);
    if (hit && hit.expires > now) return { zone, servers: hit.servers };
  }
  return { zone: '.', servers: roots };
}
