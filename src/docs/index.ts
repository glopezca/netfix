/** The whole documentation: groups for the Documentación tab, full-text search and man pages for the terminal. */
import type { DocBlock, DocGroup, DocPage } from './types.ts';
import { NETFIX_DOCS } from './netfix.ts';
import { IOS_DOCS } from './ios.ts';
import { SERVICE_DOCS } from './services.ts';
import { CLIENT_DOCS } from './clients.ts';
import { LINUX_DOCS } from './linux.ts';
import { BASH_LANGUAGE } from './bash-lang.ts';
import { BASH_REFERENCE } from './bash-ref.ts';
import { EDITOR_DOCS, NANO_KEYS, VIM_EX, VIM_KEYS } from './editors.ts';
import { UTIL_DOCS } from './utils.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';
import { INTERNET_DOCS } from './internet.ts';
import { WEBAPP_DOCS } from './webapps.ts';
import { SSH_DOCS } from './ssh.ts';
import { SECURITY_DOCS } from './security.ts';

export type { DocBlock, DocGroup, DocPage } from './types.ts';

export const DOC_GROUPS: readonly DocGroup[] = [
  NETFIX_DOCS,
  IOS_DOCS,
  { ...SERVICE_DOCS, pages: [...SERVICE_DOCS.pages, ...SSH_DOCS, ...WEBAPP_DOCS] },
  INTERNET_DOCS,
  SECURITY_DOCS,
  CLIENT_DOCS,
  { id: 'linux', title: 'Terminal Linux', pages: [...LINUX_DOCS, ...EDITOR_DOCS] },
  { id: 'bash', title: 'GNU bash 5.3', pages: [...BASH_LANGUAGE, ...BASH_REFERENCE] },
];

export function findPage(id: string): DocPage | undefined {
  return DOC_GROUPS.flatMap((g) => g.pages).find((p) => p.id === id);
}

/** Lower case without accents, for searching. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function blockText(b: DocBlock): string {
  switch (b.kind) {
    case 'list': return b.items.join('\n');
    case 'table': return [b.head.join(' '), ...b.rows.map((r) => r.join(' '))].join('\n');
    default: return b.text;
  }
}

export interface SearchHit {
  readonly page: DocPage;
  readonly group: DocGroup;
  /** The text around the first match (titles weigh more than the body). */
  readonly snippet: string;
  readonly score: number;
}

const SNIPPET = 90;
const MAX_HITS = 40;

/** Every page containing all the words of the query, best matches first. */
export function searchDocs(query: string): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const group of DOC_GROUPS) {
    for (const page of group.pages) {
      const title = fold(`${page.title} ${page.summary}`);
      const lines = page.blocks.flatMap((b) => blockText(b).split('\n'));
      const body = fold(lines.join('\n'));
      if (!words.every((w) => title.includes(w) || body.includes(w))) continue;
      const score = words.reduce((n, w) => n + (title.includes(w) ? 10 : 0) + body.split(w).length - 1, 0);
      const line = lines.find((l) => fold(l).includes(words[0] ?? '')) ?? page.summary;
      const at = Math.max(0, fold(line).indexOf(words[0] ?? '') - 30);
      hits.push({ page, group, score, snippet: `${at > 0 ? '…' : ''}${line.slice(at, at + SNIPPET)}${line.length > at + SNIPPET ? '…' : ''}` });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
}

// ------------------------------------------------------------ man

const WIDTH = 78;
const INDENT = '       ';

function header(name: string, section: number): string {
  const tag = `${name.toUpperCase()}(${section})`;
  const mid = section === 8 ? 'System Administration' : 'User Commands';
  const gap = Math.max(1, Math.floor((WIDTH - tag.length * 2 - mid.length) / 2));
  return `${tag}${' '.repeat(gap)}${mid}${' '.repeat(Math.max(1, WIDTH - tag.length * 2 - mid.length - gap))}${tag}`;
}

function wrap(text: string): string[] {
  return text.split('\n').flatMap((para) => {
    const out: string[] = [];
    let line = '';
    for (const word of para.split(' ')) {
      if (line && (INDENT + line + word).length > WIDTH) { out.push(INDENT + line.trimEnd()); line = ''; }
      line += `${word} `;
    }
    out.push(INDENT + line.trimEnd());
    return out;
  });
}

function section(title: string, text: string): string[] {
  return [title, ...wrap(text), ''];
}

const KEY_TABLES: Readonly<Record<string, string>> = {
  nano: NANO_KEYS.map(([k, d]) => `${k.padEnd(24)} ${d}`).join('\n'),
  vim: [...VIM_KEYS, ...VIM_EX].map(([k, d]) => `${k.padEnd(28)} ${d}`).join('\n'),
};

/** The manual page of a program (null when there is none, like man's «No manual entry»). */
export function manPage(name: string): string | null {
  const key = name === 'vi' || name === 'view' ? 'vim' : name;
  if (key === 'bash' || key === 'sh') return bashManual();
  const doc = UTIL_DOCS[key];
  if (!doc) return null;
  const sec = doc.section ?? 1;
  const lines = [header(key, sec), '', ...section('NAME', `${key} - ${doc.summary}`), ...section('SYNOPSIS', doc.synopsis)];
  if (doc.options) lines.push('OPTIONS', ...doc.options.split('\n').map((l) => INDENT + l), '');
  if (KEY_TABLES[key]) lines.push('KEYS', ...(KEY_TABLES[key] ?? '').split('\n').map((l) => INDENT + l), '');
  lines.push('SEE ALSO', `${INDENT}La pestaña Documentación de Netfix tiene ejemplos y la referencia completa.`, '', `Netfix${' '.repeat(WIDTH - 'Netfix'.length - `${key.toUpperCase()}(${sec})`.length)}${key.toUpperCase()}(${sec})`);
  return `${lines.join('\n')}\n`;
}

function bashManual(): string {
  const builtins = Object.keys(BUILTIN_DOCS).sort().join(' ');
  const pages = [...BASH_LANGUAGE, ...BASH_REFERENCE].map((p) => `${p.title}: ${p.summary}`).join('\n');
  return [header('bash', 1), '', ...section('NAME', 'bash - GNU Bourne-Again SHell (versión 5.3.20 en Netfix)'),
    ...section('SYNOPSIS', 'bash [opciones] [orden_o_fichero ...]'),
    ...section('DESCRIPTION', 'Intérprete de órdenes compatible con sh que ejecuta lo que se escribe en la terminal o se lee de un fichero. La referencia completa está en la pestaña Documentación:'),
    ...pages.split('\n').map((l) => INDENT + l), '',
    ...section('SHELL BUILTIN COMMANDS', `${builtins}\nUsa «help orden» para ver cada una.`), ''].join('\n');
}

/** Section of the manual page of a program (whereis), or undefined. */
export function manSection(name: string): number | undefined {
  if (name === 'bash' || name === 'sh') return 1;
  const doc = UTIL_DOCS[name];
  return doc ? doc.section ?? 1 : undefined;
}

/** man -k: programs whose name or summary contains the word. */
export function apropos(word: string): string[] {
  const w = fold(word);
  return Object.keys(UTIL_DOCS).sort().filter((n) => fold(`${n} ${UTIL_DOCS[n]?.summary ?? ''}`).includes(w))
    .map((n) => `${`${n} (${UTIL_DOCS[n]?.section ?? 1})`.padEnd(20)}- ${UTIL_DOCS[n]?.summary ?? ''}`);
}
