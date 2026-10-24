/**
 * Terminals of the documentation: Linux shell, IOS CLI or Windows cmd with the prompt and the typed command set apart
 * from the output (as students see them), or a file highlighted in vim's colours.
 */
import { el } from './dom.ts';
import { fillSyntax } from './syntax-view.ts';
import type { TermLang } from '../docs/types.ts';
import type { Filetype } from '../editors/vim-syntax.ts';

const PROMPTS: Readonly<Record<'shell' | 'ios' | 'cmd', RegExp>> = {
  shell: /^((?:[\w.-]+@[\w.-]+:[^\s$#]*|root@[\w.-]+:[^\s#]*)[$#] )(.*)$/,
  ios: /^([A-Za-z][\w.-]*(?:\([\w-]+\))?[>#])(.*)$/,
  cmd: /^((?:[A-Z]:\\[^>]*|PS [A-Z]:\\[^>]*)> ?)(.*)$/,
};

/** A typed line: its prompt and its command; null for output. */
export function promptOf(lang: 'shell' | 'ios' | 'cmd', line: string): { prompt: string; command: string } | null {
  const m = PROMPTS[lang].exec(line);
  return m ? { prompt: m[1] ?? '', command: m[2] ?? '' } : null;
}

export function docTerm(lang: TermLang, text: string): HTMLElement {
  const pre = el('pre', { class: `doc-term doc-term-${lang}` });
  if (lang !== 'shell' && lang !== 'ios' && lang !== 'cmd') return fillSyntax(pre, text, lang as Filetype);
  text.split('\n').forEach((line, i) => {
    if (i) pre.append('\n');
    const typed = promptOf(lang, line);
    if (!typed) return void pre.append(el('span', { class: 'doc-term-out' }, line));
    pre.append(el('span', { class: 'doc-term-prompt' }, typed.prompt), el('span', { class: 'doc-term-cmd' }, typed.command));
  });
  return pre;
}
