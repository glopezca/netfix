/** Español (España): zonas de bind9 (SOA, NS, directa o inversa) y sus comprobaciones al estilo named-checkzone. */
export const ZONES_ES = {
  'zone.err.name': 'Nombre de zona no válido: «{name}» (por ejemplo aula.lab o 1.168.192.in-addr.arpa).',
  'zone.err.exists': 'La zona «{name}» ya existe.',
  'zone.err.ns': 'Una zona necesita al menos un servidor de nombres (registro NS).',
  'zone.err.nsName': 'Servidor de nombres no válido: «{name}».',
  'zone.err.reverseName': 'Una zona inversa se llama como su red al revés, terminada en .in-addr.arpa (192.168.1 → 1.168.192.in-addr.arpa).',
  'zone.err.forwardName': '«{name}» es un nombre de zona inversa: elige «Inversa» o usa un dominio (aula.lab).',
  'zone.err.mname': 'Servidor primario (SOA) no válido: «{name}».',
  'zone.err.rname': 'Correo del responsable no válido: «{value}» (por ejemplo admin@aula.lab).',
  'zone.err.timer': 'Los tiempos del SOA son números enteros de segundos (0 a 2147483647).',
  'zone.err.type': 'Una zona {kind} no admite registros {type}.',
  'zone.kind.forward': 'directa',
  'zone.kind.reverse': 'inversa',
  'zone.chk.glue': 'El servidor de nombres {ns} está dentro de la zona y no tiene registro A (named-checkzone: «NS has no address records»).',
  'zone.chk.cname': '«{name}» tiene un CNAME y otros datos: un CNAME no puede convivir con otros registros del mismo nombre.',
  'zone.chk.type': 'Registro {type} de «{name}»: una zona {kind} no lo admite y BIND no carga la zona.',
  'zone.chk.out': '«{name}» está fuera de la zona {zone}: BIND lo ignora (out-of-zone data).',
} as const;

export type ZonesKey = keyof typeof ZONES_ES;
