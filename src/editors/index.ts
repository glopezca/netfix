/** Builds the editor engine an `edit` interaction asks for (nano or vim). */
import type { EditSpec } from '../bash/types.ts';
import type { Editor, EditorIO } from './buffer.ts';
import { NanoEditor } from './nano.ts';
import { VimEditor } from './vim.ts';

export type { Editor, EditorIO, Frame, KeyInput, Span, SpanStyle } from './buffer.ts';

export function createEditor(spec: EditSpec, io: EditorIO): Editor {
  return spec.editor === 'nano' ? new NanoEditor(spec, io) : new VimEditor(spec, io);
}
