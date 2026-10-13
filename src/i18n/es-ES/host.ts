/** Español (España): pestañas de PC y Servidor (Equipo, Configuración IP) y ventanas de equipo. */
export const HOST_ES = {
  'host.nameTitle': 'Nombre del equipo',
  'host.label': 'Nombre visible (área de trabajo)',
  'host.labelHint': 'Solo identifica el icono; no cambia la red.',
  'host.hostname': 'Nombre de host',
  'host.hostnameHint': 'Lo envía el cliente DHCP (opción 12) y lo muestran el prompt, /etc/hostname y hostname.',
  'host.pretty': 'Nombre descriptivo (pretty hostname)',
  'host.prettyHint': 'Solo en GNU/Linux: lo muestra hostnamectl.',
  'host.prettyPlaceholder': 'Opcional, texto libre',
  'host.save': 'Guardar',
  'host.useLabel': 'Usar el nombre visible',
  'host.labelEmpty': 'El nombre visible no puede estar vacío.',
  'host.saved': 'Guardado. Nombre de host: {name}.',
  'host.equivalents': 'Equivalencias',
  'host.eqLinux': 'GNU/Linux: sudo hostnamectl set-hostname NOMBRE (persistente) o sudo hostname NOMBRE (solo hasta reiniciar). bash muestra el nombre nuevo en una shell nueva (exec bash).',
  'host.eqWindows': 'Windows: Configuración → Sistema → Cambiar el nombre de este equipo.',
  'host.now': 'Ahora mismo: estático «{static}»',
  'host.nowTransient': ', transitorio «{name}»',
  'host.nowPretty': ', descriptivo «{name}»',
  'host.live': 'Estos campos se actualizan solos cuando cambias el nombre o la red desde la terminal.',
  'host.err.empty': 'El nombre de host no puede estar vacío.',
  'host.err.long': 'El nombre de host admite como máximo {max} caracteres.',
  'host.err.label': 'Cada parte del nombre admite como máximo {max} caracteres.',
  'host.err.chars': 'Usa solo letras sin tilde, números y guiones (sin espacios; no puede empezar ni acabar en guion).',
} as const;

export type HostKey = keyof typeof HOST_ES;
