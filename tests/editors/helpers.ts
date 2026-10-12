/** Feeds key sequences to editor engines: plain text plus <Esc> <CR> <BS> <Del> <Tab> <Up> <Down> <Left> <Right> <C-x> <M-u>. */
import type { Editor, Frame, KeyInput } from '../../src/editors/index.ts';
import type { EditSpec } from '../../src/bash/types.ts';

const NAMED: Readonly<Record<string, string>> = {
  Esc: 'Escape', CR: 'Enter', BS: 'Backspace', Del: 'Delete', Tab: 'Tab', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Home: 'Home', End: 'End', PgDn: 'PageDown', PgUp: 'PageUp',
};

export function keys(ed: Editor, seq: string): void {
  for (const m of seq.matchAll(/<([A-Za-z]+|[CM]-.)>|[\s\S]/g)) {
    const name = m[1];
    let k: KeyInput;
    if (name === undefined) k = { key: m[0] };
    else if (name.startsWith('C-')) k = { key: name.slice(2), ctrl: true };
    else if (name.startsWith('M-')) k = { key: name.slice(2), alt: true };
    else k = { key: NAMED[name] ?? name };
    ed.key(k);
  }
}

export function screen(f: Frame): string[] {
  return f.rows.map((r) => r.map((s) => s.text).join('').trimEnd());
}

export function spec(content: string, extra: Partial<EditSpec> = {}): EditSpec {
  return { editor: 'nano', path: '/home/alumno/notas.txt', content, exists: content !== '', readOnly: false, ...extra };
}

/** An in-memory disk recording every save. */
export function disk(fail?: string): { saves: [string, string][]; save(path: string, content: string): string | null } {
  const saves: [string, string][] = [];
  return { saves, save: (path, content) => { if (fail) return fail; saves.push([path, content]); return null; } };
}
