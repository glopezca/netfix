/** Structure of the built-in documentation (rendered by the Ayuda tab and by `man`/`help`). */
import type { Filetype } from '../editors/vim-syntax.ts';

/** Kinds of the palette, for the diagrams and the group icons. */
export type FigKind = 'pc' | 'server' | 'switch' | 'router' | 'linuxrouter' | 'cloud';

/** Icon of a group of the help: a palette kind, or a topic (networking concepts, the terminal, bash scripts, labs). */
export type TopicIcon = 'network' | 'terminal' | 'script' | 'mission';
export type GroupIcon = FigKind | TopicIcon;

export interface FigNode {
  readonly id: string;
  readonly kind: FigKind;
  readonly label: string;
  /** Position in a 0-100 × 0-60 grid. */
  readonly x: number;
  readonly y: number;
  /** A line under the label (an address, a role). */
  readonly note?: string;
}

/** A small diagram drawn by the app: a topology with the palette icons, or a sequence of messages between actors. */
export type Figure =
  | { readonly type: 'topology'; readonly nodes: readonly FigNode[]; readonly links: readonly { readonly a: string; readonly b: string; readonly label?: string }[] }
  | { readonly type: 'sequence'; readonly actors: readonly string[]; readonly messages: readonly { readonly from: number; readonly to: number; readonly text: string; readonly note?: string }[] };

/** Advice boxes: a tip, a warning (typical mistakes), how to check it worked, an exercise (with its solution folded). */
export type Tone = 'tip' | 'warn' | 'check' | 'exercise';
/** A terminal: Linux shell, IOS CLI or Windows cmd (prompts highlighted), or a file in vim's colours. */
export type TermLang = 'shell' | 'ios' | 'cmd' | Filetype;

export type DocBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'h'; readonly text: string; readonly level?: 4 }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'steps'; readonly items: readonly { readonly title: string; readonly text: string }[] }
  | { readonly kind: 'callout'; readonly tone: Tone; readonly title: string; readonly text: string; readonly solution?: string; readonly solutionLabel?: string }
  | { readonly kind: 'figure'; readonly figure: Figure; readonly caption: string }
  | { readonly kind: 'term'; readonly lang: TermLang; readonly text: string };

export interface DocPage {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly DocBlock[];
  /** Texts use inline Markdown (links, **bold**, `code`), resolved against this base URL. */
  readonly markdownBase?: string;
  /** The section of its group in the navigation (a service of a device, for example). */
  readonly section?: string;
}

export interface DocGroup {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly DocPage[];
  /** The icon shown next to the group: the palette one for devices, a topic one for the rest. */
  readonly icon?: GroupIcon;
}

export const p = (text: string): DocBlock => ({ kind: 'p', text });
export const h = (text: string): DocBlock => ({ kind: 'h', text });
export const code = (text: string): DocBlock => ({ kind: 'code', text });
export const list = (...items: string[]): DocBlock => ({ kind: 'list', items });
export const note = (text: string): DocBlock => ({ kind: 'note', text });
export const table = (head: readonly string[], rows: readonly (readonly string[])[]): DocBlock => ({ kind: 'table', head, rows });
export const steps = (...items: (readonly [string, string])[]): DocBlock => ({ kind: 'steps', items: items.map(([title, text]) => ({ title, text })) });
export const tip = (title: string, text: string): DocBlock => ({ kind: 'callout', tone: 'tip', title, text });
export const warn = (title: string, text: string): DocBlock => ({ kind: 'callout', tone: 'warn', title, text });
export const check = (title: string, text: string): DocBlock => ({ kind: 'callout', tone: 'check', title, text });
export const exercise = (title: string, text: string, solution: string): DocBlock => ({ kind: 'callout', tone: 'exercise', title, text, solution });
export const figure = (fig: Figure, caption: string): DocBlock => ({ kind: 'figure', figure: fig, caption });
export const term = (lang: TermLang, text: string): DocBlock => ({ kind: 'term', lang, text });
