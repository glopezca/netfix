/**
 * A small Markdown reader for the «Acerca de» tab (LICENSE.md): block structure becomes DocBlocks
 * and inline text becomes plain spans (links, bold, code). The output is data, never HTML.
 */
import type { DocBlock } from './types.ts';

export interface InlineSpan {
  readonly text: string;
  readonly href?: string;
  readonly bold?: boolean;
  readonly code?: boolean;
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*[-*+]\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && body[i + 1] === '|') { cur += '|'; i++; } else if (c === '|') { cells.push(cur.trim()); cur = ''; } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines: readonly string[], i: number): boolean {
  return (lines[i] ?? '').trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '');
}

/** Reads the block starting at line i; returns it (or null for a skipped title) and the next line. */
function readBlock(lines: readonly string[], i: number): { block: DocBlock | null; next: number } {
  const line = lines[i] ?? '';
  if (FENCE.test(line)) {
    const end = lines.findIndex((l, j) => j > i && FENCE.test(l));
    const stop = end < 0 ? lines.length : end;
    return { block: { kind: 'code', text: lines.slice(i + 1, stop).join('\n') }, next: stop + 1 };
  }
  const h = HEADING.exec(line);
  if (h) {
    const level = (h[1] ?? '').length;
    const text = (h[2] ?? '').trim();
    if (level === 1) return { block: null, next: i + 1 };
    return { block: level === 2 ? { kind: 'h', text } : { kind: 'h', text, level: 4 }, next: i + 1 };
  }
  if (isTableStart(lines, i)) {
    let j = i + 2;
    while (j < lines.length && (lines[j] ?? '').trim().startsWith('|')) j++;
    return { block: { kind: 'table', head: splitRow(line), rows: lines.slice(i + 2, j).map(splitRow) }, next: j };
  }
  const collect = (test: (l: string) => boolean, strip: (l: string) => string): { text: string[]; next: number } => {
    let j = i;
    const out: string[] = [];
    while (j < lines.length && (lines[j] ?? '').trim() !== '' && test(lines[j] ?? '')) out.push(strip(lines[j++] ?? '').trim());
    return { text: out, next: j };
  };
  if (LIST_ITEM.test(line)) {
    const r = collect((l) => LIST_ITEM.test(l), (l) => LIST_ITEM.exec(l)?.[1] ?? l);
    return { block: { kind: 'list', items: r.text }, next: r.next };
  }
  if (line.trimStart().startsWith('>')) {
    const r = collect((l) => l.trimStart().startsWith('>'), (l) => l.trimStart().replace(/^>\s?/, ''));
    return { block: { kind: 'note', text: r.text.join(' ') }, next: r.next };
  }
  const r = collect((l) => !FENCE.test(l) && !HEADING.test(l) && !LIST_ITEM.test(l) && !l.trimStart().startsWith('>'), (l) => l);
  return { block: { kind: 'p', text: r.text.join(' ') }, next: Math.max(r.next, i + 1) };
}

/** Markdown → blocks. The level-1 heading (the page title) is left to the caller. */
export function markdownBlocks(markdown: string): DocBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? '').trim() === '') { i++; continue; }
    const { block, next } = readBlock(lines, i);
    if (block) blocks.push(block);
    i = next;
  }
  return blocks;
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|<(https?:\/\/[^>\s]+)>/g;
const SAFE_RELATIVE = /^[\w./#-]+$/;

/** http(s) URLs as they are; relative paths resolved against `base`; anything else is refused. */
export function safeHref(url: string, base: string): string | undefined {
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^[a-z][\w+.-]*:/i.test(url) || !SAFE_RELATIVE.test(url)) return undefined;
  return `${base}${url.replace(/^\.\//, '')}`;
}

/** Inline Markdown → spans. `base` resolves relative links (files of the repository). */
export function inlineMarkdown(text: string, base: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: text.slice(last, at) });
    last = at + m[0].length;
    if (m[1] !== undefined) spans.push({ text: m[1], code: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
    else if (m[5] !== undefined) spans.push({ text: m[5], href: m[5] });
    else {
      const label = m[3] ?? '';
      const code = /^`[^`]+`$/.test(label);
      const shown = code ? label.slice(1, -1) : label;
      const href = safeHref(m[4] ?? '', base);
      spans.push(href ? { text: shown, href, ...(code ? { code } : {}) } : { text: shown });
    }
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}
