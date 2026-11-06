/**
 * What a program writes becomes journal lines as journald stores them: one entry per line, control characters shown
 * escaped (\x1b) so a message cannot fake another line or colour the terminal, and an overlong line cut (LineMax).
 */
const MAX_LINE = 2048;

const escape = (c: string): string => `\\x${(c.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}`;

export function journalLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => {
    const clean = l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, escape);
    return clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE)}…` : clean;
  });
}
