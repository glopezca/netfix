/** Undo and redo on the network view: the keyboard shortcuts and the state of the palette buttons. */

/** Ctrl+Z (undo), Ctrl+Y or Ctrl+Shift+Z (redo); not while typing or inside a window (it has its own undo). */
export function undoShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  const key = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || e.altKey || (key !== 'z' && key !== 'y')) return null;
  const target = e.target;
  if (target instanceof Element && target.closest('input, textarea, select, .win-layer')) return null;
  if (target instanceof HTMLElement && target.isContentEditable) return null;
  return key === 'y' || e.shiftKey ? 'redo' : 'undo';
}

/** The undo and redo buttons are enabled only when there is something to undo or redo. */
export function syncUndoButtons(palette: HTMLElement, edits: { canUndo(): boolean; canRedo(): boolean }): void {
  const undo = palette.querySelector<HTMLButtonElement>('.undo-btn');
  const redo = palette.querySelector<HTMLButtonElement>('.redo-btn');
  if (undo) undo.disabled = !edits.canUndo();
  if (redo) redo.disabled = !edits.canRedo();
}
