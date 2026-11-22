/** Midnight Commander's F5 copy, F6 rename/move, F7 mkdir and F8 delete, through the user's shell (McFs). */
import type { McApp } from './mc.ts';
import { joinPath } from './mc-fs.ts';
import { mcFormat, mcQ, mcT } from './mc-i18n.ts';

export const NO_DRIVE = 'The system cannot find the drive specified.';

function what(names: readonly string[]): string {
  return names.length === 1 ? `"${names[0]}"` : `${names.length} ${mcT('files/directories')}`;
}

/** What F5, F6 and F8 work on: the marked files (or the one under the cursor); on a tree, its folder. */
function picked(app: McApp): { readonly names: string[]; readonly paths: string[] } {
  const p = app.panel;
  if (p.tree) return { names: [p.dir.split('/').pop() || p.dir], paths: [p.dir] };
  const names = p.selection();
  return { names, paths: names.map((n) => joinPath(p.dir, n)) };
}

/** F5 / F6: into the folder typed, the other panel's by default. */
export function copyOrMove(app: McApp, op: 'copy' | 'move'): void {
  const { names, paths } = picked(app);
  if (!names.length) return;
  app.dialog = {
    kind: 'input', title: mcQ(op === 'copy' ? 'DialogTitle|Copy' : 'DialogTitle|Move'), label: mcFormat(mcT(op === 'copy' ? 'Copy %s to:' : 'Move %s to:'), what(names)),
    value: app.folderText(app.other.dir),
    onOk: (target) => {
      const to = app.typed(target);
      const err = to === null ? NO_DRIVE : op === 'copy' ? app.fs.copy(paths, to) : app.fs.move(paths, to);
      app.panel.marked.clear();
      app.fail(err);
    },
  };
}

/** F7: the folder typed, from the active panel's. */
export function makeDir(app: McApp, name: string): void {
  if (!name.trim()) return;
  const path = app.typed(name);
  const err = path === null ? NO_DRIVE : app.fs.mkdir(path);
  app.fail(err);
  if (!err) app.panel.reload(app.fs, name.trim().split(/[\\/]/).pop());
}

/** F8: what is picked, after mc's question (unless Confirmation › Delete is off). */
export function removePicked(app: McApp): void {
  const { names, paths } = picked(app);
  if (!names.length) return;
  const doIt = (): void => {
    const err = app.fs.remove(paths);
    app.panel.marked.clear();
    app.fail(err);
  };
  if (!app.setup.confirmDelete) { doIt(); return; }
  app.dialog = { kind: 'confirm', title: mcQ('DialogTitle|Delete'), text: mcFormat(mcT('Delete %s?'), what(names)), yes: true, onYes: doIt };
}
