/**
 * La gramática de kea-dhcp4.conf (Kea 2.6) que usa kea-json.ts: las claves que admite cada mapa y su tipo. Los bloques
 * que Netfix no comprueba por dentro (hooks, clases, bases de datos de hosts…) se leen como JSON cualquiera. Aquí están
 * también las definiciones de las opciones estándar de DHCPv4 que se pueden nombrar en option-data.
 */
import type { ListSpec, MapSpec, Spec } from './kea-json.ts';

const STRINGS: ListSpec = { list: 'string' };
const COMMON: Readonly<Record<string, Spec>> = { comment: 'string', 'user-context': 'any' };

const OPTION_DATA: ListSpec = { list: { map: 'option-data', keys: {
  name: 'string', data: 'string', code: 'integer', space: 'string', 'csv-format': 'boolean', 'always-send': 'boolean',
  'never-send': 'boolean', 'client-classes': STRINGS, ...COMMON,
} } };

const RESERVATIONS: ListSpec = { list: { map: 'reservations', keys: {
  'hw-address': 'string', 'client-id': 'string', duid: 'string', 'circuit-id': 'string', 'flex-id': 'string',
  'ip-address': 'string', hostname: 'string', 'next-server': 'string', 'server-hostname': 'string',
  'boot-file-name': 'string', 'option-data': OPTION_DATA, 'client-classes': STRINGS, ...COMMON,
} } };

const POOLS: ListSpec = { list: { map: 'pools', keys: {
  pool: 'string', 'pool-id': 'integer', 'option-data': OPTION_DATA, 'client-class': 'string',
  'require-client-classes': STRINGS, 'evaluate-additional-classes': STRINGS, ...COMMON,
} } };

/** Parámetros que valen en Dhcp4 y en cada subred (la subred hereda los globales). */
const NETWORK: Readonly<Record<string, Spec>> = {
  'valid-lifetime': 'integer', 'min-valid-lifetime': 'integer', 'max-valid-lifetime': 'integer', 'renew-timer': 'integer',
  'rebind-timer': 'integer', 'calculate-tee-times': 'boolean', 't1-percent': 'float', 't2-percent': 'float',
  'match-client-id': 'boolean', authoritative: 'boolean', 'next-server': 'string', 'server-hostname': 'string',
  'boot-file-name': 'string', 'reservations-global': 'boolean', 'reservations-in-subnet': 'boolean',
  'reservations-out-of-pool': 'boolean', 'store-extended-info': 'boolean', 'cache-threshold': 'float',
  'cache-max-age': 'integer', 'offer-lifetime': 'integer', allocator: 'string', 'option-data': OPTION_DATA,
  'ddns-send-updates': 'boolean', 'ddns-override-no-update': 'boolean', 'ddns-override-client-update': 'boolean',
  'ddns-replace-client-name': 'string', 'ddns-generated-prefix': 'string', 'ddns-qualifying-suffix': 'string',
  'hostname-char-set': 'string', 'hostname-char-replacement': 'string', 'ddns-update-on-renew': 'boolean',
  'ddns-use-conflict-resolution': 'boolean', 'ddns-conflict-resolution-mode': 'string', 'ddns-ttl-percent': 'float',
  'ddns-ttl': 'integer', 'ddns-ttl-min': 'integer', 'ddns-ttl-max': 'integer', 'reservation-mode': 'string',
  'reservations-lookup-first': 'boolean', ...COMMON,
};

const SUBNET4: ListSpec = { list: { map: 'subnet4', keys: {
  ...NETWORK, id: 'integer', subnet: 'string', pools: POOLS, reservations: RESERVATIONS, interface: 'string',
  relay: 'any', 'client-class': 'string', 'require-client-classes': STRINGS, 'evaluate-additional-classes': STRINGS,
  '4o6-interface': 'string', '4o6-interface-id': 'string', '4o6-subnet': 'string', 'shared-network-name': 'string',
} } };

const INTERFACES: MapSpec = { map: 'interfaces-config', keys: {
  interfaces: STRINGS, 'dhcp-socket-type': 'string', 'outbound-interface': 'string', 're-detect': 'boolean',
  'service-sockets-require-all': 'boolean', 'service-sockets-max-retries': 'integer',
  'service-sockets-retry-wait-time': 'integer', ...COMMON,
} };

const database = (map: string): MapSpec => ({ map, keys: {
  type: 'string', persist: 'boolean', name: 'string', 'lfc-interval': 'integer', host: 'string', port: 'integer',
  user: 'string', password: 'string', 'max-row-errors': 'integer', 'connect-timeout': 'integer', readonly: 'boolean',
  'max-reconnect-tries': 'integer', 'reconnect-wait-time': 'integer', 'on-fail': 'string', 'retry-on-startup': 'boolean',
  'trust-anchor': 'string', 'cert-file': 'string', 'key-file': 'string', 'cipher-list': 'string', ...COMMON,
} });

const DHCP4: MapSpec = { map: 'Dhcp4', keys: {
  ...NETWORK, 'interfaces-config': INTERFACES, 'lease-database': database('lease-database'),
  'hosts-database': database('hosts-database'), 'hosts-databases': { list: database('hosts-databases') },
  subnet4: SUBNET4, reservations: RESERVATIONS, 'host-reservation-identifiers': STRINGS, 'dhcp4o6-port': 'integer',
  'decline-probation-period': 'integer', 'echo-client-id': 'boolean', 'server-tag': 'string',
  'ip-reservations-unique': 'boolean', 'early-global-reservations-lookup': 'boolean', 'parked-packet-limit': 'integer',
  'statistic-default-sample-count': 'integer', 'statistic-default-sample-age': 'integer', 'stash-agent-options': 'boolean',
  'shared-networks': 'any', 'option-def': 'any', 'client-classes': 'any', 'control-socket': 'any', 'control-sockets': 'any',
  'dhcp-ddns': 'any', loggers: 'any', 'hooks-libraries': 'any', 'expired-leases-processing': 'any',
  'multi-threading': 'any', 'sanity-checks': 'any', 'dhcp-queue-control': 'any', compatibility: 'any', 'config-control': 'any',
} };

export const KEA_TOPLEVEL: MapSpec = { map: 'toplevel', keys: { Dhcp4: DHCP4 } };

/** Tipo de los datos de una opción: una dirección, una lista de direcciones u otro (no se comprueba). */
export type OptionType = 'ip' | 'ips' | 'other';
export interface OptionDef { readonly code: number; readonly type: OptionType }

const def = (code: number, type: OptionType = 'other'): OptionDef => ({ code, type });

/** Opciones estándar del espacio dhcp4 (RFC 2132 y siguientes) por su nombre en Kea. */
export const DHCP4_OPTIONS: Readonly<Record<string, OptionDef>> = {
  'subnet-mask': def(1, 'ip'), 'time-offset': def(2), routers: def(3, 'ips'), 'time-servers': def(4, 'ips'),
  'name-servers': def(5, 'ips'), 'domain-name-servers': def(6, 'ips'), 'log-servers': def(7, 'ips'),
  'cookie-servers': def(8, 'ips'), 'lpr-servers': def(9, 'ips'), 'host-name': def(12), 'boot-size': def(13),
  'domain-name': def(15), 'swap-server': def(16, 'ip'), 'root-path': def(17), 'ip-forwarding': def(19),
  'default-ip-ttl': def(23), 'interface-mtu': def(26), 'broadcast-address': def(28, 'ip'), 'static-routes': def(33, 'ips'),
  'nis-domain': def(40), 'nis-servers': def(41, 'ips'), 'ntp-servers': def(42, 'ips'),
  'vendor-encapsulated-options': def(43), 'netbios-name-servers': def(44, 'ips'), 'netbios-dd-server': def(45, 'ips'),
  'netbios-node-type': def(46), 'netbios-scope': def(47), 'dhcp-lease-time': def(51), 'dhcp-server-identifier': def(54, 'ip'),
  'dhcp-message': def(56), 'dhcp-max-message-size': def(57), 'dhcp-renewal-time': def(58), 'dhcp-rebinding-time': def(59),
  'vendor-class-identifier': def(60), 'tftp-server-name': def(66), 'boot-file-name': def(67),
  'smtp-server': def(69, 'ips'), 'pop-server': def(70, 'ips'), 'www-server': def(72, 'ips'), 'user-class': def(77),
  'v4-captive-portal': def(114), 'domain-search': def(119), 'classless-static-route': def(121),
  'impress-servers': def(10, 'ips'), 'resource-location-servers': def(11, 'ips'), 'merit-dump': def(14),
  'extensions-path': def(18), 'non-local-source-routing': def(20), 'policy-filter': def(21, 'ips'),
  'max-dgram-reassembly': def(22), 'path-mtu-aging-timeout': def(24), 'path-mtu-plateau-table': def(25),
  'all-subnets-local': def(27), 'perform-mask-discovery': def(29), 'mask-supplier': def(30), 'router-discovery': def(31),
  'router-solicitation-address': def(32, 'ip'), 'trailer-encapsulation': def(34), 'arp-cache-timeout': def(35),
  'ieee802-3-encapsulation': def(36), 'default-tcp-ttl': def(37), 'tcp-keepalive-interval': def(38),
  'tcp-keepalive-garbage': def(39), 'font-servers': def(48, 'ips'), 'x-display-manager': def(49, 'ips'),
  'dhcp-requested-address': def(50, 'ip'), 'dhcp-option-overload': def(52), 'dhcp-message-type': def(53),
  'dhcp-parameter-request-list': def(55), 'dhcp-client-identifier': def(61), 'nwip-domain-name': def(62),
  'nwip-suboptions': def(63), 'nisplus-domain-name': def(64), 'nisplus-servers': def(65, 'ips'),
  'mobile-ip-home-agent': def(68, 'ips'), 'nntp-server': def(71, 'ips'), 'finger-server': def(73, 'ips'),
  'irc-server': def(74, 'ips'), 'streettalk-server': def(75, 'ips'), 'streettalk-directory-assistance-server': def(76, 'ips'),
  'slp-directory-agent': def(78), 'slp-service-scope': def(79), fqdn: def(81), 'dhcp-agent-options': def(82),
  'nds-servers': def(85, 'ips'), 'nds-tree-name': def(86), 'nds-context': def(87), 'bcms-controller-names': def(88),
  'bcms-controller-address': def(89, 'ips'), authenticate: def(90), 'client-last-transaction-time': def(91),
  'associated-ip': def(92, 'ips'), 'client-system': def(93), 'client-ndi': def(94), 'uuid-guid': def(97),
  'uap-servers': def(98), 'geoconf-civic': def(99), pcode: def(100), tcode: def(101), 'v6-only-preferred': def(108),
  'netinfo-server-address': def(112, 'ips'), 'netinfo-server-tag': def(113), 'auto-config': def(116),
  'name-service-search': def(117), 'subnet-selection': def(118, 'ip'), 'vivco-suboptions': def(124),
  'vivso-suboptions': def(125), 'pana-agent': def(136, 'ips'), 'v4-lost': def(137), 'capwap-ac-v4': def(138, 'ips'),
  'sip-ua-cs-domains': def(141), 'rdnss-selection': def(146), 'v4-portparams': def(159), 'v4-dnr': def(162),
  'option-6rd': def(212), 'v4-access-domain': def(213),
};
