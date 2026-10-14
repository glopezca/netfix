/** Tokens of the nft language (command line and rule files), with positions for nft's ^^^ error marks. */

export type TokenKind = 'word' | 'string' | 'punct' | 'newline';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  /** Offset in the source line and the line number (1-based). */
  readonly col: number;
  readonly line: number;
}

const PUNCT = new Set(['{', '}', ';', ',']);
/** Characters that may appear inside a word: names, addresses, ranges, prefixes, ports, $variables. */
const WORD = /[A-Za-z0-9_.\-/:$@*!=<>+]/;
/** Longest source accepted (a big nftables.conf is a few KB). */
export const MAX_SOURCE = 256 * 1024;

export type LexResult = { ok: true; tokens: Token[] } | { ok: false; error: string; line: number; col: number; len: number };

/** Splits `src` into tokens; `#` starts a comment until the end of the line (outside strings). */
export function lex(src: string): LexResult {
  if (src.length > MAX_SOURCE) return { ok: false, error: 'Error: input too large', line: 1, col: 0, len: 1 };
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    const col = i - lineStart;
    if (c === '\n') {
      tokens.push({ kind: 'newline', text: '\n', col, line });
      line++;
      lineStart = ++i;
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '\\' && src[i + 1] === '\n') {
      line++;
      i += 2;
      lineStart = i;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0 || src.slice(i + 1, end).includes('\n')) return { ok: false, error: 'Error: syntax error, unterminated string', line, col, len: 1 };
      tokens.push({ kind: 'string', text: src.slice(i + 1, end), col, line });
      i = end + 1;
    } else if (PUNCT.has(c)) {
      tokens.push({ kind: 'punct', text: c, col, line });
      i++;
    } else if (WORD.test(c)) {
      let j = i;
      while (j < src.length && WORD.test(src[j] ?? '')) j++;
      tokens.push({ kind: 'word', text: src.slice(i, j), col, line });
      i = j;
    } else {
      return { ok: false, error: `Error: syntax error, unexpected junk`, line, col, len: 1 };
    }
  }
  return { ok: true, tokens };
}

/** nft's error block: message, the source line and carets under the culprit. */
export function errorBlock(message: string, sourceLine: string, col: number, len: number): string {
  return `${message}\n${sourceLine}\n${' '.repeat(Math.max(0, col))}${'^'.repeat(Math.max(1, len))}`;
}
