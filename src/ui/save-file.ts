/** Saving the topology: clipboard in the embedded artifact, file picker when available, download otherwise. */
import { el } from './dom.ts';
import { Topology } from '../net/topology.ts';
import { t } from '../i18n/t.ts';

type Picker = (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;

/** The status line message, and whether the topology really left the app (so there is nothing unsaved). */
export interface SaveResult {
  readonly message: string;
  readonly saved: boolean;
}

function copyToClipboard(json: string): Promise<SaveResult> {
  const failed = { message: t('hint.copyFailed'), saved: false };
  const clip = navigator.clipboard;
  if (!clip) return Promise.resolve(failed);
  return clip.writeText(json).then(() => ({ message: t('hint.copied'), saved: true }), () => failed);
}

/** Saves the topology (the message is '' when the user cancelled). */
export async function saveTopology(topo: Topology): Promise<SaveResult> {
  const json = JSON.stringify(topo.toJSON(), null, 2);
  if (document.getElementById('app')?.dataset.embed === 'artifact') return copyToClipboard(json);
  const name = `${t('file.prefix')}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.netfix.json`;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: t('file.description'), accept: { 'application/json': ['.json'] } }] });
      const w = await handle.createWritable();
      await w.write(json);
      await w.close();
      return { message: t('hint.saved'), saved: true };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { message: '', saved: false };
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { message: t('hint.downloaded', { name }), saved: true };
}

/** A topology file the user picked: the topology, or the message saying why it cannot be opened. */
export async function readTopologyFile(file: File): Promise<Topology | string> {
  try {
    return Topology.fromJSON(JSON.parse(await file.text()));
  } catch (err) {
    return t('hint.openFailed', { name: file.name, error: err instanceof Error ? err.message : t('hint.unknownFormat') });
  }
}
