/**
 * What Windows does with a single-label name the DNS did not answer: it asks by LLMNR and by NetBIOS at the same time
 * and keeps the LLMNR answer; the NetBIOS one only when LLMNR finds nothing.
 */
import type { Host } from '../devices/host.ts';
import { LLMNR_WAIT_MS, llmnrLookup } from './llmnr.ts';
import { NBNS_WAIT_MS, WORKSTATION, nbnsLookup } from './netbios.ts';
import { runSync } from './sync.ts';

const MARGIN_MS = 500;

export function windowsLinkResolve(host: Host, name: string): number | undefined {
  return runSync<number | undefined>(host.hooks, (done) => {
    let llmnr: number | undefined | null = null;
    let nbns: number | undefined | null = null;
    const settle = (): void => {
      if (llmnr !== null && llmnr !== undefined) done(llmnr);
      else if (llmnr === undefined && nbns !== null) done(nbns);
    };
    llmnrLookup(host, name, (ip) => { llmnr = ip; settle(); });
    nbnsLookup(host, name, WORKSTATION, (ip) => { nbns = ip; settle(); });
  }, Math.max(LLMNR_WAIT_MS, NBNS_WAIT_MS) + MARGIN_MS);
}
