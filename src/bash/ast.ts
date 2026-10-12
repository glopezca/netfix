/** Abstract syntax tree of the bash interpreter. Words keep their raw source text. */

export interface Word {
  /** Source text including quotes, e.g. `"$HOME"/x`. */
  readonly raw: string;
  /** Argument of declare/local/export/readonly/typeset that is an assignment. */
  readonly assign?: Assignment;
}

export type RedirOp = '<' | '>' | '>>' | '>|' | '<>' | '<<' | '<<-' | '<<<' | '<&' | '>&' | '&>' | '&>>';

export interface HereDoc {
  body: string;
  /** Delimiter was quoted: no expansion of the body. */
  readonly quoted: boolean;
}

export interface Redirect {
  /** Explicit descriptor (`2>`), undefined = default for the operator. */
  readonly fd?: number;
  /** `{name}>file`: allocate a descriptor and store it in `name`. */
  readonly varFd?: string;
  readonly op: RedirOp;
  readonly target: Word;
  readonly heredoc?: HereDoc;
}

export interface ArrayElement {
  /** Raw subscript text for `[key]=value`. */
  readonly key?: string;
  readonly value: Word;
}

export interface Assignment {
  readonly name: string;
  /** Raw subscript for `name[sub]=value`. */
  readonly index?: string;
  readonly append: boolean;
  readonly value?: Word;
  /** `name=(a b [k]=v)` */
  readonly array?: readonly ArrayElement[];
}

export interface SimpleCommand {
  readonly kind: 'simple';
  readonly assigns: readonly Assignment[];
  readonly words: readonly Word[];
  readonly redirs: readonly Redirect[];
  readonly line: number;
  /** Source text of the command and offset of its first word (alias expansion). */
  readonly source: string;
  readonly wordAt: number;
}

export interface CaseItem {
  readonly patterns: readonly Word[];
  readonly body?: Command;
  readonly term: ';;' | ';&' | ';;&';
}

export type CondExpr =
  | { readonly kind: 'unary'; readonly op: string; readonly arg: Word }
  | { readonly kind: 'binary'; readonly op: string; readonly left: Word; readonly right: Word }
  | { readonly kind: 'not'; readonly expr: CondExpr }
  | { readonly kind: 'and' | 'or'; readonly left: CondExpr; readonly right: CondExpr }
  | { readonly kind: 'word'; readonly arg: Word };

interface WithRedirs {
  readonly redirs: readonly Redirect[];
}

export type Compound =
  | ({ readonly kind: 'subshell'; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'group'; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'if'; readonly clauses: readonly { readonly cond: Command; readonly body: Command }[]; readonly elseBody?: Command } & WithRedirs)
  | ({ readonly kind: 'while'; readonly until: boolean; readonly cond: Command; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'for'; readonly name: string; readonly words?: readonly Word[]; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'select'; readonly name: string; readonly words?: readonly Word[]; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'arith_for'; readonly init: string; readonly cond: string; readonly step: string; readonly body: Command } & WithRedirs)
  | ({ readonly kind: 'case'; readonly word: Word; readonly items: readonly CaseItem[] } & WithRedirs)
  | ({ readonly kind: 'arith'; readonly expr: string; readonly line: number } & WithRedirs)
  | ({ readonly kind: 'cond'; readonly expr: CondExpr; readonly line: number } & WithRedirs);

export interface FunctionDef {
  readonly kind: 'function';
  readonly name: string;
  readonly body: Compound;
  /** Source text of the definition, for `declare -f` and `type`. */
  readonly source: string;
}

export interface Pipeline {
  readonly kind: 'pipeline';
  readonly cmds: readonly Command[];
  /** `|&` after element i: its stderr goes into the pipe too. */
  readonly stderrToPipe: readonly boolean[];
  readonly negate: boolean;
  readonly timed: boolean;
}

export interface AndOr {
  readonly kind: 'and_or';
  readonly first: Command;
  readonly rest: readonly { readonly op: '&&' | '||'; readonly cmd: Command }[];
}

export interface ListItem {
  readonly cmd: Command;
  /** Terminated by `&`. */
  readonly async: boolean;
  /** Source text, used for job notifications and history. */
  readonly source: string;
}

export interface List {
  readonly kind: 'list';
  readonly items: readonly ListItem[];
}

export type Command = SimpleCommand | Compound | FunctionDef | Pipeline | AndOr | List;
