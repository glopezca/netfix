/** Structure of the built-in documentation (rendered by the Documentación tab and by `man`/`help`). */

export type DocBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'h'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'note'; readonly text: string };

export interface DocPage {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly DocBlock[];
}

export interface DocGroup {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly DocPage[];
}

export const p = (text: string): DocBlock => ({ kind: 'p', text });
export const h = (text: string): DocBlock => ({ kind: 'h', text });
export const code = (text: string): DocBlock => ({ kind: 'code', text });
export const list = (...items: string[]): DocBlock => ({ kind: 'list', items });
export const note = (text: string): DocBlock => ({ kind: 'note', text });
export const table = (head: readonly string[], rows: readonly (readonly string[])[]): DocBlock => ({ kind: 'table', head, rows });
