/** Panels that follow their device: they redraw when it changes (from the terminal, DHCP…) unless you are typing in them. */
import { el } from './dom.ts';
import type { Host } from '../devices/host.ts';

export interface LivePanel {
  readonly root: HTMLElement;
  dispose(): void;
}

export function liveHostPanel(host: Pick<Host, 'onChange'>, render: (refresh: () => void) => HTMLElement[]): LivePanel {
  const root = el('div', { class: 'pane' });
  let stale = false;
  const refresh = (): void => {
    stale = false;
    root.replaceChildren(...render(refresh));
  };
  const onChange = (): void => {
    if (root.contains(document.activeElement) && document.activeElement !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) stale = true;
    else refresh();
  };
  root.addEventListener('focusout', (e) => {
    if (stale && !root.contains(e.relatedTarget as Node | null)) refresh();
  });
  const off = host.onChange(onChange);
  refresh();
  return { root, dispose: off };
}
