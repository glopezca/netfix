/** English (UK): Netfix's own texts in Midnight Commander (help and credits). */
import type { McKey } from '../es-ES/mc.ts';

export const MC_EN: Readonly<Record<McKey, string>> = {
  'mc.help.title': 'Help',
  'mc.help.1': 'Tab: switch panel   Insert / Ctrl+T: mark',
  'mc.help.2': 'Enter: open directory   Ctrl+R: reread',
  'mc.help.3': 'F3 view · F4 edit · F5 copy · F6 move/rename',
  'mc.help.4': 'F7 make directory · F8 delete · F10 quit',
  'mc.help.5': 'No function keys: Esc then the number (Esc 5 = F5)',
  'mc.help.about': 'F2 or F9: Netfix credits',
  'mc.about.title': 'About',
  'mc.about.app': 'Netfix {version} · network simulator',
  'mc.about.author': 'Author: {author}',
  'mc.about.license': 'Licence: {license}',
  'mc.about.mc': 'Interface based on GNU Midnight Commander 4.8',
  'mc.about.mcCopy': '© Free Software Foundation, Inc. · GNU GPL v3+',
  'mc.about.menus': 'Pull-down menus are not available in Netfix.',
  'mc.footer': 'Netfix {version} · © {author}',
};
