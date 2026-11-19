/**
 * `netfix.code(mount, options)` (Codefix, D24): a Netfix terminal — bash on GNU/Linux or cmd.exe on Windows — on a
 * one-PC lab, for a host page that edits the files itself (FixIT Classroom with Monaco). The handle lists, writes and
 * removes the user's files as that user and exports the lab as a topology file, which is what the host saves.
 */
import { CodeLab, type CodeLabFile } from '../classroom/code-lab.ts';
import { Topology } from '../net/topology.ts';
import type { HostOs } from '../devices/host.ts';
import { createShell } from '../shells/factory.ts';
import { Terminal } from './terminal.ts';
import { checkMount } from './embed-api.ts';

export interface CodeHandle {
  files(): CodeLabFile[];
  write(path: string, content: string): void;
  remove(path: string): void;
  exportTopology(): unknown;
  /** Runs a line in the terminal as if typed (a Run button: `bash main.sh`). */
  run(line: string): void;
  focus(): void;
  destroy(): void;
}

interface CodeOptions {
  readonly os: HostOs;
  readonly topology: unknown;
  readonly files: readonly CodeLabFile[];
  readonly onRun: (() => void) | null;
}

function codeOptions(v: unknown): CodeOptions {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const extra = Object.keys(o).find((k) => !['os', 'topology', 'files', 'onRun'].includes(k));
  if (extra) throw new Error(`netfix.code: opción desconocida «${extra}»`);
  if (o.os !== 'linux' && o.os !== 'windows') throw new Error('netfix.code: «os» debe ser linux o windows');
  if (o.onRun !== undefined && typeof o.onRun !== 'function') throw new Error('netfix.code: «onRun» debe ser una función');
  const files = o.files ?? [];
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'object' && f !== null && typeof f.path === 'string' && typeof f.content === 'string')) {
    throw new Error('netfix.code: «files» debe ser una lista de { path, content }');
  }
  return { os: o.os, topology: o.topology, files: files as CodeLabFile[], onRun: (o.onRun as () => void) ?? null };
}

export function mountCode(mount: HTMLElement, options?: unknown): CodeHandle {
  checkMount(mount);
  const o = codeOptions(options);
  const lab = new CodeLab(o.os, o.topology === undefined ? undefined : Topology.fromJSON(o.topology));
  for (const f of o.files) lab.write(f.path, f.content);
  const term = new Terminal(createShell(lab.pc, o.os, lab.user), { label: o.os === 'windows' ? 'cmd.exe' : 'bash', afterRun: () => o.onRun?.() });
  mount.classList.add('netfix-root');
  mount.dataset.code = o.os;
  mount.replaceChildren(term.root);
  return {
    files: () => lab.files(),
    write: (path, content) => lab.write(path, content),
    remove: (path) => lab.remove(path),
    exportTopology: () => lab.toJSON(),
    run: (line) => term.type(line),
    focus: () => term.focus(),
    destroy: () => {
      term.dispose();
      mount.replaceChildren();
      mount.classList.remove('netfix-root');
      delete mount.dataset.code;
      if (mount.getAttribute('class') === '') mount.removeAttribute('class'); // the host's element as it was
    },
  };
}
