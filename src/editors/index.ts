/** Builds the editor engine an `edit` interaction asks for (nano, vim or the Windows terminal's edit). */
import type { EditSpec } from '../bash/types.ts';
import type { Editor, EditorIO } from './buffer.ts';
import { NanoEditor } from './nano.ts';
import { VimEditor } from './vim.ts';
import { MsEditEditor } from './msedit.ts';

export type { Editor, EditorIO, Frame, KeyInput, Span, SpanStyle } from './buffer.ts';

export function createEditor(spec: EditSpec, io: EditorIO): Editor {
  if (spec.editor === 'msedit') return new MsEditEditor(spec, io);
  return spec.editor === 'nano' ? new NanoEditor(spec, io) : new VimEditor(spec, io);
}
