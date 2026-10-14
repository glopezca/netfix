/** The whole documentation: groups for the Documentation tab, full-text search and man pages for the terminal. */
import type { DocBlock, DocGroup, DocPage } from './types.ts';
import type { UtilDoc } from './utils.ts';
import type { BuiltinDoc } from './bash-builtins.ts';
import { getLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { docSet } from './sets.ts';

export type { DocBlock, DocGroup, DocPage } from './types.ts';

/** Groups of the Documentation tab in the current language. */
export function docGroups(locale: Locale = getLocale()): readonly DocGroup[] {
  return docSet(locale).groups;
}

/** Programs documented for man (in the current language). */
export function utilDocs(locale: Locale = getLocale()): Readonly<Record<string, UtilDoc>> {
  return docSet(locale).utils;
}

/** bash builtins documented for help (in the current language). */
export function builtinDocs(locale: Locale = getLocale()): Readonly<Record<string, BuiltinDoc>> {
  return docSet(locale).builtins;
}

/** First line of `help` without arguments. */
export function helpIntro(): string {
  return docSet(getLocale()).man.helpIntro;
}

/** man's note when the name is a bash builtin. */
export function builtinHint(name: string): string {
  return docSet(getLocale()).man.builtinHint(name);
}

export function findPage(id: string): DocPage | undefined {
  return docGroups().flatMap((g) => g.pages).find((p) => p.id === id);
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
  for (const group of docGroups()) {
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

function keyTable(key: string): string | null {
  const set = docSet(getLocale());
  if (key === 'nano') return set.nanoKeys.map(([k, d]) => `${k.padEnd(24)} ${d}`).join('\n');
  if (key === 'vim') return set.vimKeys.map(([k, d]) => `${k.padEnd(28)} ${d}`).join('\n');
  return null;
}

/** The manual page of a program (null when there is none, like man's «No manual entry»). */
export function manPage(name: string): string | null {
  const key = name === 'vi' || name === 'view' ? 'vim' : name;
  if (key === 'bash' || key === 'sh') return bashManual();
  const doc = utilDocs()[key];
  if (!doc) return null;
  const sec = doc.section ?? 1;
  const lines = [header(key, sec), '', ...section('NAME', `${key} - ${doc.summary}`), ...section('SYNOPSIS', doc.synopsis)];
  if (doc.options) lines.push('OPTIONS', ...doc.options.split('\n').map((l) => INDENT + l), '');
  const keys = keyTable(key);
  if (keys) lines.push('KEYS', ...keys.split('\n').map((l) => INDENT + l), '');
  lines.push('SEE ALSO', `${INDENT}${docSet(getLocale()).man.seeAlso}`, '', `Netfix${' '.repeat(WIDTH - 'Netfix'.length - `${key.toUpperCase()}(${sec})`.length)}${key.toUpperCase()}(${sec})`);
  return `${lines.join('\n')}\n`;
}

function bashManual(): string {
  const set = docSet(getLocale());
  const builtins = Object.keys(set.builtins).sort().join(' ');
  const pages = set.bashPages.map((p) => `${p.title}: ${p.summary}`).join('\n');
  return [header('bash', 1), '', ...section('NAME', set.man.bashName),
    ...section('SYNOPSIS', set.man.bashSynopsis),
    ...section('DESCRIPTION', set.man.bashDescription),
    ...pages.split('\n').map((l) => INDENT + l), '',
    ...section('SHELL BUILTIN COMMANDS', `${builtins}\n${set.man.bashHelp}`), ''].join('\n');
}

/** Section of the manual page of a program (whereis), or undefined. */
export function manSection(name: string): number | undefined {
  if (name === 'bash' || name === 'sh') return 1;
  const doc = utilDocs()[name];
  return doc ? doc.section ?? 1 : undefined;
}

/** man -k: programs whose name or summary contains the word. */
export function apropos(word: string): string[] {
  const w = fold(word);
  const docs = utilDocs();
  return Object.keys(docs).sort().filter((n) => fold(`${n} ${docs[n]?.summary ?? ''}`).includes(w))
    .map((n) => `${`${n} (${docs[n]?.section ?? 1})`.padEnd(20)}- ${docs[n]?.summary ?? ''}`);
}
