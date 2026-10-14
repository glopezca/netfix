/**
 * Credits shown by Netfix's Midnight Commander: those of Netfix, and those of GNU Midnight Commander, whose
 * interface it reproduces (names as published on midnight-commander.org/maintainers; they are not translated).
 */
import { aboutInfo } from '../docs/about.ts';
import { t } from '../i18n/t.ts';

/** The release whose interface and `mc --version` Netfix reproduces. */
export const MC_RELEASE = '4.8.33';
export const MC_COPYRIGHT = 'Copyright (C) 1994-2025 Free Software Foundation, Inc.';
export const MC_SITE = 'https://midnight-commander.org';
export const MC_FOUNDER = 'Miguel de Icaza';
export const MC_MAINTAINERS: readonly string[] = ['Andrew Borodin', 'Yury V. Zaytsev'];
export const MC_FORMER_MAINTAINERS: readonly string[] = ['Pavel Tsekov', 'Pavel Roskin', 'Miguel de Icaza'];
export const MC_FORMER_TEAM: readonly string[] = [
  'Egmont Koblinger', 'Stan. S. Krupoderov', 'Ilia Maslakov', 'mooffie', 'Mikhail S. Pabalavets',
  'Sergei Trofimovich', 'Enrico Weigelt', 'Patrick Winnertz', 'Slava Zanko',
];

const INDENT = '   ';
const LINE = 44;
/** The viewer cuts long lines (a phone terminal is narrow): texts are wrapped at this width. */
const TEXT = 56;

function wrapText(text: string): string[] {
  if (text.length <= TEXT) return [text];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > TEXT) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...out, line] : out;
}

/** Names separated by commas, in lines of at most LINE characters. */
function nameLines(names: readonly string[]): string[] {
  const out: string[] = [];
  let line = '';
  for (const [i, n] of names.entries()) {
    const piece = `${n}${i < names.length - 1 ? ',' : ''}`;
    if (line && line.length + 1 + piece.length > LINE) { out.push(INDENT + line); line = piece; } else line = line ? `${line} ${piece}` : piece;
  }
  if (line) out.push(INDENT + line);
  return out;
}

/** Credits of Netfix, then those of GNU Midnight Commander (shown in the viewer with F2 / F9). */
export function mcCredits(): string[] {
  const a = aboutInfo();
  const lines = [
    t('mc.about.app', { version: a.version }), t('mc.about.author', { author: a.author }),
    t('mc.about.license', { license: a.license }), a.repository.replace(/^https:\/\//, ''), '',
    t('mc.about.reproduces'), '',
    `GNU Midnight Commander ${MC_RELEASE}`, MC_COPYRIGHT, t('mc.about.mcLicense'), MC_SITE, '',
    t('mc.about.founded', { name: MC_FOUNDER }), '',
    t('mc.about.maintainers'), ...nameLines(MC_MAINTAINERS),
    t('mc.about.formerMaintainers'), ...nameLines(MC_FORMER_MAINTAINERS),
    t('mc.about.formerTeam'), ...nameLines(MC_FORMER_TEAM),
    t('mc.about.contributors'), '',
    t('mc.about.menus'), t('mc.about.close'),
  ];
  return lines.flatMap(wrapText);
}
