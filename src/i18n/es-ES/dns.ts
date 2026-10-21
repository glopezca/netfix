/** Español (España): recursión y reenviadores de bind9 (GUI y gestión web). */
export const DNS_ES = {
  'dns.rec.localnets': 'Red local (localnets)',
  'dns.rec.any': 'Cualquiera (any: resolvedor abierto, no recomendado)',
  'dns.relay': 'DNS del operador (relé)',
  'dns.relayHint': 'El DHCP de la línea entrega la IP del router como DNS y este reenvía las consultas a 8.8.8.8 y 8.8.4.4 (con caché), como el router de casa.',
  'dns.relayOn': 'DNS: {ip} (relé del operador a 8.8.8.8 y 8.8.4.4).',
  'dns.err.ip': '«{value}» no es una dirección IPv4.',
  'dns.err.many': 'Como máximo {max} reenviadores.',
} as const;

export type DnsKey = keyof typeof DNS_ES;
