/** Español (España): recursión y reenviadores de bind9 (GUI y gestión web). */
export const DNS_ES = {
  'dns.relay': 'DNS del operador (relé)',
  'dns.relayHint': 'El DHCP de la línea entrega la dirección IP del router como DNS y este reenvía las consultas a 8.8.8.8 y 8.8.4.4 (con caché), como el router de casa.',
  'dns.relayOn': 'DNS: {ip} (relé del operador a 8.8.8.8 y 8.8.4.4).',
  'dns.err.ip': '«{value}» no es una dirección IPv4.',
  'dns.err.aml': '«{value}» no es un elemento de la lista: una red (192.168.0.0/24), una dirección, localnets, localhost, any o none, con ! delante para excluirlo.',
  'dns.err.amlEmpty': 'La lista está vacía: escribe none para no dar recursión a nadie.',
  'dns.err.amlMany': 'Como mucho {max} elementos en la lista.',
  'dns.err.many': 'Como máximo {max} reenviadores.',
} as const;

export type DnsKey = keyof typeof DNS_ES;
