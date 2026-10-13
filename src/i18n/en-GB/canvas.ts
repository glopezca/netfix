/** English (UK): workspace (canvas, cables, ports). */
import type { CanvasKey } from '../es-ES/canvas.ts';

export const CANVAS_EN: Readonly<Record<CanvasKey, string>> = {
  'canvas.label': 'Logical workspace',
  'canvas.hint.select': 'Drag to move; drag the background to pan. Double-click, double-tap or long-press to open.',
  'canvas.hint.cable': 'Cable: tap the first device and choose a port.',
  'canvas.hint.delete': 'Delete: tap a device or a cable.',
  'canvas.hint.place': 'Tap the workspace to place the device.',
  'canvas.connectTo': 'Connect to {name}',
  'canvas.from': 'From {name}',
  'canvas.cableFrom': 'Cable from {name} {port}: choose the other end.',
  'canvas.connectFailed': 'Could not connect: {error}.',
  'canvas.unknownError': 'unknown error',
};
