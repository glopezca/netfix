/** Español (España): textos propios de Netfix en Midnight Commander (ayuda y créditos). */
export const MC_ES = {
  'mc.help.title': 'Ayuda',
  'mc.help.1': 'Tab: cambiar de panel   Insert / Ctrl+T: marcar',
  'mc.help.2': 'Intro: entrar en el directorio   Ctrl+R: releer',
  'mc.help.3': 'F3 ver · F4 editar · F5 copiar · F6 mover/renombrar',
  'mc.help.4': 'F7 crear directorio · F8 borrar · F9 menús · F10 salir',
  'mc.help.5': 'Sin teclas de función: Esc y el número (Esc 5 = F5); Esc y una letra = Alt y la letra',
  'mc.help.about': 'Alt+, paneles lado a lado o uno sobre otro (Opciones › Presentación). Debajo, los créditos.',
  'mc.about.title': 'Acerca de · Netfix y GNU Midnight Commander',
  'mc.about.app': 'Netfix {version} · simulador de redes',
  'mc.about.author': 'Autoría: {author}',
  'mc.about.license': 'Licencia: {license}',
  'mc.about.reproduces': 'Este gestor reproduce la interfaz de GNU Midnight Commander; no incluye su código.',
  'mc.about.mcLicense': 'Licencia: GNU GPL v3 o posterior',
  'mc.about.founded': 'Fundado en 1994 por {name}.',
  'mc.about.maintainers': 'Mantenedores actuales:',
  'mc.about.formerMaintainers': 'Mantenedores anteriores:',
  'mc.about.formerTeam': 'Antiguos miembros del equipo:',
  'mc.about.contributors': 'Y los demás colaboradores (historial de git).',
  'mc.about.translatorsEs': 'Traducción al español de mc:',
  'mc.about.translatorsEnGb': 'Traducción al inglés británico de mc:',
  'mc.about.translatorsAll': 'Y los equipos de traducción de los demás idiomas ({site}).',
  'mc.about.close': 'q, Esc o F10: volver a los paneles.',
  'mc.about.menus': 'Sus textos en español son los de la traducción de mc (GNU GPL v3 o posterior).',
  'mc.footer': 'Netfix {version} · © {author}',
} as const;

export type McKey = keyof typeof MC_ES;
