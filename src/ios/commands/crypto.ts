/** IPsec configuration commands of the 2911: ISAKMP policies and keys, transform sets, crypto maps. */
import type { CommandDef, Match } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { defaultPolicy, ESP_AUTH, ESP_ENCRYPTION, withMapEntry, withPolicy } from '../crypto-config.ts';
import type { CryptoConfig, CryptoMapEntry, IsakmpPolicy } from '../crypto-config.ts';
import { parseIp } from '../../core/ip.ts';

type Def = CommandDef<Cli<Router>>;

const INVALID = '% Invalid input detected.';
const MAP_NOTE = ['% NOTE: This new crypto map will remain disabled until a peer', '        and a valid access list have been configured.'];

function setCrypto(cli: Cli<Router>, change: (c: CryptoConfig) => CryptoConfig): void {
  cli.device.crypto = change(cli.device.crypto);
}

function policy(cli: Cli<Router>): IsakmpPolicy | undefined {
  const n = Number(cli.session.crypto);
  return cli.device.crypto.policies.find((p) => p.priority === n);
}

function setPolicy(cli: Cli<Router>, change: Partial<IsakmpPolicy>): void {
  const p = policy(cli);
  if (p) setCrypto(cli, (c) => withPolicy(c, { ...p, ...change }));
}

function mapEntry(cli: Cli<Router>): CryptoMapEntry | undefined {
  const [map, seq] = (cli.session.crypto ?? '').split(' ');
  return cli.device.crypto.maps.find((m) => m.map === map && m.seq === Number(seq));
}

function setEntry(cli: Cli<Router>, change: (e: CryptoMapEntry) => CryptoMapEntry): void {
  const e = mapEntry(cli);
  if (e) setCrypto(cli, (c) => withMapEntry(c, change(e)));
}

/** `esp-aes 256 esp-sha-hmac` → transforms, or null when the combination is not valid. */
function transforms(text: string): string[] | null {
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    const withBits = /^(128|192|256)$/.test(words[i + 1] ?? '') && w === 'esp-aes' ? `${w} ${words[++i]}` : w;
    if ((ESP_ENCRYPTION as readonly string[]).includes(withBits) || (ESP_AUTH as readonly string[]).includes(withBits)) out.push(withBits);
    else return null;
  }
  const enc = out.filter((t) => (ESP_ENCRYPTION as readonly string[]).includes(t)).length;
  const auth = out.filter((t) => (ESP_AUTH as readonly string[]).includes(t)).length;
  return enc === 1 && auth <= 1 ? out : null;
}

function cryptoMap(cli: Cli<Router>, m: Match): void {
  const map = m.get('map') ?? '';
  const seq = Number(m.get('seq'));
  if (!cli.device.crypto.maps.some((e) => e.map === map && e.seq === seq)) {
    setCrypto(cli, (c) => withMapEntry(c, { map, seq }));
    cli.out(...MAP_NOTE);
  }
  cli.session.crypto = `${map} ${seq}`;
  cli.session.enterMode('config-crypto-map');
}

export const CRYPTO_GLOBAL: readonly Def[] = [
  {
    syntax: 'crypto isakmp policy <1-10000:p>',
    help: { p: 'Priority of protection suite' },
    run: (cli, m) => {
      const p = Number(m.get('p'));
      if (!cli.device.crypto.policies.some((x) => x.priority === p)) setCrypto(cli, (c) => withPolicy(c, defaultPolicy(p)));
      cli.session.crypto = String(p);
      cli.session.enterMode('config-isakmp');
    },
    noRun: (cli, m) => setCrypto(cli, (c) => ({ ...c, policies: c.policies.filter((x) => x.priority !== Number(m.get('p'))) })),
  },
  {
    syntax: 'crypto isakmp key <WORD:key> address <A.B.C.D:addr> [<A.B.C.D:mask>]',
    help: { key: 'pre-shared key', addr: 'define shared key with IP address', mask: 'Peer IP subnet mask' },
    run: (cli, m) => {
      const address = parseIp(m.get('addr') ?? '');
      const mask = m.get('mask') ? parseIp(m.get('mask') ?? '') : 0xffffffff;
      if (address === null || mask === null) return cli.out(INVALID);
      setCrypto(cli, (c) => ({ ...c, keys: [...c.keys.filter((k) => k.address !== address), { key: m.get('key') ?? '', address, mask }] }));
    },
    noRun: (cli, m) => setCrypto(cli, (c) => ({ ...c, keys: c.keys.filter((k) => k.address !== parseIp(m.get('addr') ?? '')) })),
  },
  {
    syntax: 'crypto ipsec transform-set <WORD:name> <LINE:transforms>',
    help: { name: 'Transform set tag', transforms: 'esp-aes [128|192|256], esp-3des, esp-des, esp-sha-hmac, esp-md5-hmac…' },
    run: (cli, m) => {
      const list = transforms(m.get('transforms') ?? '');
      if (!list) return cli.out(INVALID);
      const name = m.get('name') ?? '';
      setCrypto(cli, (c) => ({ ...c, transformSets: [...c.transformSets.filter((t) => t.name !== name), { name, transforms: list, mode: 'tunnel' }] }));
      cli.session.crypto = name;
      cli.session.enterMode('cfg-crypto-trans');
    },
    noRun: (cli, m) => setCrypto(cli, (c) => ({ ...c, transformSets: c.transformSets.filter((t) => t.name !== m.get('name')) })),
  },
  {
    syntax: 'crypto map <WORD:map> <1-65535:seq> ipsec-isakmp',
    help: { map: 'Crypto map tag', seq: 'Sequence to insert into crypto map entry', 'ipsec-isakmp': 'IPSEC w/ISAKMP' },
    run: cryptoMap,
    noRun: (cli, m) => setCrypto(cli, (c) => ({ ...c, maps: c.maps.filter((e) => !(e.map === m.get('map') && e.seq === Number(m.get('seq')))) })),
  },
  { syntax: 'crypto map <WORD:map>', run: (cli) => cli.out('% Incomplete command.'), noRun: (cli, m) => setCrypto(cli, (c) => ({ ...c, maps: c.maps.filter((e) => e.map !== m.get('map')) })), hidden: true },
];

const LEAVE: readonly Def[] = [
  { syntax: 'exit', run: (cli) => { cli.session.crypto = undefined; cli.session.enterMode('config'); } },
  { syntax: 'end', run: (cli) => cli.session.endConfig() },
  { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') },
];

export const ISAKMP_MODE: readonly Def[] = [
  { syntax: 'encryption {des | 3des | aes [{128 | 192 | 256}]}', run: (cli, m) => setPolicy(cli, { encryption: m.has('des') ? 'des' : m.has('3des') ? '3des' : `aes${['192', '256'].find((b) => m.has(b)) ? ` ${['192', '256'].find((b) => m.has(b))}` : ''}` }), noRun: (cli) => setPolicy(cli, { encryption: 'des' }) },
  { syntax: 'hash {sha | md5}', run: (cli, m) => setPolicy(cli, { hash: m.has('md5') ? 'md5' : 'sha' }), noRun: (cli) => setPolicy(cli, { hash: 'sha' }) },
  { syntax: 'authentication {pre-share | rsa-sig | rsa-encr}', run: (cli, m) => setPolicy(cli, { auth: m.has('pre-share') ? 'pre-share' : m.has('rsa-encr') ? 'rsa-encr' : 'rsa-sig' }), noRun: (cli) => setPolicy(cli, { auth: 'rsa-sig' }) },
  { syntax: 'group {1 | 2 | 5}', run: (cli, m) => setPolicy(cli, { group: m.has('5') ? 5 : m.has('2') ? 2 : 1 }), noRun: (cli) => setPolicy(cli, { group: 1 }) },
  { syntax: 'lifetime <60-86400:s>', run: (cli, m) => setPolicy(cli, { lifetime: Number(m.get('s')) }), noRun: (cli) => setPolicy(cli, { lifetime: 86400 }) },
  ...LEAVE,
];

export const CRYPTO_MAP_MODE: readonly Def[] = [
  { syntax: 'set peer <A.B.C.D:peer>', run: (cli, m) => { const p = parseIp(m.get('peer') ?? ''); if (p !== null) setEntry(cli, (e) => ({ ...e, peer: p })); }, noRun: (cli) => setEntry(cli, (e) => ({ ...e, peer: undefined })) },
  { syntax: 'set transform-set <WORD:ts>', run: (cli, m) => setEntry(cli, (e) => ({ ...e, transformSet: m.get('ts') })), noRun: (cli) => setEntry(cli, (e) => ({ ...e, transformSet: undefined })) },
  { syntax: 'set pfs {group1 | group2 | group5}', run: (cli, m) => setEntry(cli, (e) => ({ ...e, pfs: ['group1', 'group2', 'group5'].find((g) => m.has(g)) })), noRun: (cli) => setEntry(cli, (e) => ({ ...e, pfs: undefined })) },
  { syntax: 'match address <WORD:acl>', run: (cli, m) => setEntry(cli, (e) => ({ ...e, acl: m.get('acl') })), noRun: (cli) => setEntry(cli, (e) => ({ ...e, acl: undefined })) },
  ...LEAVE,
];

export const TRANSFORM_MODE: readonly Def[] = [
  {
    syntax: 'mode {tunnel | transport}',
    run: (cli, m) => setCrypto(cli, (c) => ({ ...c, transformSets: c.transformSets.map((t) => (t.name === cli.session.crypto ? { ...t, mode: m.has('transport') ? 'transport' : 'tunnel' } : t)) })),
  },
  ...LEAVE,
];

export const CRYPTO_IF: readonly Def[] = [
  {
    syntax: 'crypto map <WORD:map>',
    run: (cli, m) => {
      const first = !cli.device.sortedIfaceNames().some((n) => cli.device.iface(n)?.cryptoMap);
      cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => ({ ...c, cryptoMap: m.get('map') })));
      if (first) cli.device.log('%CRYPTO-6-ISAKMP_ON_OFF: ISAKMP is ON');
    },
    noRun: (cli) => cli.session.ifaces.forEach((n) => cli.device.updateIface(n, (c) => ({ ...c, cryptoMap: undefined }))),
  },
];
