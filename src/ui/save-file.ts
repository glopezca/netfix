/** Saving the topology: clipboard in the embedded artifact, file picker when available, download otherwise. */
import { el } from './dom.ts';
import type { Topology } from '../net/topology.ts';
import { t } from '../i18n/t.ts';

type Picker = (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;

function copyToClipboard(json: string): Promise<string> {
  const clip = navigator.clipboard;
  if (!clip) return Promise.resolve(t('hint.copyFailed'));
  return clip.writeText(json).then(() => t('hint.copied'), () => t('hint.copyFailed'));
}

/** Saves and returns the message for the status line ('' when the user cancelled). */
export async function saveTopology(topo: Topology): Promise<string> {
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
      return t('hint.saved');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return '';
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return t('hint.downloaded', { name });
}
