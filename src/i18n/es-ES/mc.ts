/** Español (España): textos propios de Netfix en Midnight Commander (ayuda y créditos). */
export const MC_ES = {
  'mc.help.title': 'Ayuda',
  'mc.help.1': 'Tab: cambiar de panel   Insert / Ctrl+T: marcar',
  'mc.help.2': 'Intro: entrar en el directorio   Ctrl+R: releer',
  'mc.help.3': 'F3 ver · F4 editar · F5 copiar · F6 mover/renombrar',
  'mc.help.4': 'F7 crear directorio · F8 borrar · F10 salir',
  'mc.help.5': 'Sin teclas de función: Esc y el número (Esc 5 = F5)',
  'mc.help.about': 'F2 o F9: créditos de Netfix',
  'mc.about.title': 'Acerca de',
  'mc.about.app': 'Netfix {version} · simulador de redes',
  'mc.about.author': 'Autoría: {author}',
  'mc.about.license': 'Licencia: {license}',
  'mc.about.mc': 'Interfaz basada en GNU Midnight Commander 4.8',
  'mc.about.mcCopy': '© Free Software Foundation, Inc. · GNU GPL v3+',
  'mc.about.menus': 'Los menús desplegables no están disponibles en Netfix.',
  'mc.footer': 'Netfix {version} · © {author}',
} as const;

export type McKey = keyof typeof MC_ES;
