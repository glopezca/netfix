/** English (UK): deshacer y rehacer cambios del área de trabajo. */
import type { UndoKey } from '../es-ES/undo.ts';

export const UNDO_EN: Readonly<Record<UndoKey, string>> = {
  'undo.group': 'Undo and redo',
  'undo.cablesLeft': 'Cables not reconnected (port in use): {n}.',
  'undo.undo': 'Undo (Ctrl+Z)',
  'undo.redo': 'Redo (Ctrl+Y)',
  'undo.undone': 'Undone: {what}.',
  'undo.redone': 'Redone: {what}.',
  'undo.nothingUndo': 'Nothing to undo on the workspace.',
  'undo.nothingRedo': 'Nothing to redo.',
  'undo.add': 'adding a device',
  'undo.remove': 'deleting a device',
  'undo.connect': 'connecting a cable',
  'undo.disconnect': 'removing a cable',
  'undo.move': 'moving a device',
  'undo.drawings': 'change to the drawings',
};
