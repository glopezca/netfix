/** Español (España): recursión y reenviadores de bind9 (GUI y gestión web). */
export const DNS_ES = {
  'dns.rec.title': 'Reenvío de consultas (recursión)',
  'dns.rec.help': 'Con reenviadores, el servidor resuelve también nombres de Internet: pregunta a esos servidores (por ejemplo 8.8.8.8 y 8.8.4.4 a través de la nube del ISP), guarda la respuesta en caché y responde a sus clientes. Sin reenviadores solo responde de sus zonas (REFUSED para el resto).',
  'dns.rec.forwarders': 'Reenviadores (forwarders)',
  'dns.rec.forwardersHint': 'Direcciones IPv4 separadas por comas. Vacío = sin recursión.',
  'dns.rec.mode': 'Modo',
  'dns.rec.only': 'forward only (solo reenviadores)',
  'dns.rec.first': 'forward first (reenviadores y luego Internet)',
  'dns.rec.allow': 'Clientes con recursión (allow-recursion)',
  'dns.rec.localnets': 'Red local (localnets)',
  'dns.rec.any': 'Cualquiera (any: resolvedor abierto, no recomendado)',
  'dns.rec.save': 'Aplicar',
  'dns.rec.google': 'Usar Google (8.8.8.8, 8.8.4.4)',
  'dns.rec.flush': 'Vaciar caché (rndc flush)',
  'dns.rec.cache': 'Entradas en caché: {count}',
  'dns.rec.saved': 'Guardado. Se aplica también a /etc/bind/named.conf.options.',
  'dns.rec.flushed': 'Caché vaciada.',
  'dns.relay': 'DNS del operador (relé)',
  'dns.relayHint': 'El DHCP de la línea entrega la IP del router como DNS y este reenvía las consultas a 8.8.8.8 y 8.8.4.4 (con caché), como el router de casa.',
  'dns.relayOn': 'DNS: {ip} (relé del operador a 8.8.8.8 y 8.8.4.4).',
  'dns.err.ip': '«{value}» no es una dirección IPv4.',
  'dns.err.many': 'Como máximo {max} reenviadores.',
} as const;

export type DnsKey = keyof typeof DNS_ES;
