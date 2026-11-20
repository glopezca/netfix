/** English (UK): workspace (canvas, cables, ports). */
import type { CanvasKey } from '../es-ES/canvas.ts';

export const CANVAS_EN: Readonly<Record<CanvasKey, string>> = {
  'canvas.label': 'Logical workspace',
  'canvas.hint.select': 'Drag to move; drag the background to select with a box (Shift adds; on touch screens, press and hold the background, then drag) and pan with the wheel, the middle or right button, Space+drag or one finger. Double-click or double-tap to open; right-click, Shift+F10 or long-press for its menu. Del deletes the selection; Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate.',
  'canvas.hint.cable': 'Cable: tap the first device and choose a port.',
  'canvas.hint.delete': 'Delete: tap a device, a cable or a drawing (inside an area works too).',
  'canvas.hint.place': 'Tap the workspace to place the device.',
  'canvas.connectTo': 'Connect to {name}',
  'canvas.menu.open': 'Open',
  'canvas.menu.delete': 'Delete',
  'canvas.menu.label': '{name} menu',
  'canvas.from': 'From {name}',
  'canvas.cableFrom': 'Cable from {name} {port}: choose the other end.',
  'canvas.connectFailed': 'Could not connect: {error}.',
  'canvas.unknownError': 'unknown error',
};
