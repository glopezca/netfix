/** Español (España): deshacer y rehacer cambios del área de trabajo. */
export const UNDO_ES = {
  'undo.group': 'Deshacer y rehacer',
  'undo.cablesLeft': 'Cables sin reconectar (puerto ocupado): {n}.',
  'undo.undo': 'Deshacer (Ctrl+Z)',
  'undo.redo': 'Rehacer (Ctrl+Y)',
  'undo.undone': 'Deshecho: {what}.',
  'undo.redone': 'Rehecho: {what}.',
  'undo.nothingUndo': 'No hay nada que deshacer en el área de trabajo.',
  'undo.nothingRedo': 'No hay nada que rehacer.',
  'undo.add': 'añadir un equipo',
  'undo.remove': 'borrar un equipo',
  'undo.connect': 'conectar un cable',
  'undo.disconnect': 'quitar un cable',
  'undo.move': 'mover un equipo',
  'undo.drawings': 'cambio en los dibujos',
} as const;

export type UndoKey = keyof typeof UNDO_ES;
