/** nftables.service of a server: `nft -f /etc/nftables.conf` on start/reload, `nft flush ruleset` on stop. */
import type { Host } from './host.ts';
import { hostFs } from './host-fs.ts';
import { runNft } from '../net/nft/apply.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';

export const NFTABLES_CONF = '/etc/nftables.conf';

/** Ubuntu's default /etc/nftables.conf (an empty, accepting inet filter table). */
export const DEFAULT_NFTABLES_CONF = `#!/usr/sbin/nft -f

flush ruleset

table inet filter {
	chain input {
		type filter hook input priority filter;
	}
	chain forward {
		type filter hook forward priority filter;
	}
	chain output {
		type filter hook output priority filter;
	}
}
`;

/** Reads a file of the host as root (null when missing or not a file). */
export function readHostFile(host: Host, path: string): string | null {
  const fs = hostFs(host);
  return fs && fs.tryLookup(path)?.kind === 'file' ? fs.readFile(path) : null;
}

/** Loads /etc/nftables.conf into the kernel; returns nft's error text or null. Atomic: on error nothing changes. */
export function loadNftablesConf(host: Host): string | null {
  const text = readHostFile(host, NFTABLES_CONF);
  if (text === null) return `Error: Could not open file "${NFTABLES_CONF}": No such file or directory`;
  const r = runNft(EMPTY_RULESET, text, { read: (p) => readHostFile(host, p) });
  if (!r.ok) return r.error.split('\n').map((l, i) => (i === 0 ? `${NFTABLES_CONF}: ${l}` : l)).join('\n');
  host.kernel.netfilter.setRuleset(r.ruleset);
  return null;
}
