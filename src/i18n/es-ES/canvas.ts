/** Español (España): área de trabajo (lienzo, cables, puertos). */
export const CANVAS_ES = {
  'canvas.label': 'Área de trabajo lógica',
  'canvas.hint.select': 'Arrastra para mover; arrastra el fondo para desplazarte. Doble clic, doble toque o pulsación larga para abrir.',
  'canvas.hint.cable': 'Cable: toca el primer dispositivo y elige un puerto.',
  'canvas.hint.delete': 'Eliminar: toca un dispositivo, un cable o un dibujo (también el interior de un área).',
  'canvas.hint.place': 'Toca el área de trabajo para colocar el dispositivo.',
  'canvas.connectTo': 'Conectar a {name}',
  'canvas.from': 'Desde {name}',
  'canvas.cableFrom': 'Cable desde {name} {port}: elige el otro extremo.',
  'canvas.connectFailed': 'No se pudo conectar: {error}.',
  'canvas.unknownError': 'error desconocido',
} as const;

export type CanvasKey = keyof typeof CANVAS_ES;
