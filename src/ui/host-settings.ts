/** PC / Server-PT → «Equipo»: name shown in the workspace and the host name of the system. */
import { el } from './dom.ts';
import { field, input, button, message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import { livePanel } from './server-dhcp-dns.ts';
import type { Host } from '../devices/host.ts';
import { validHostname } from '../devices/host.ts';
import type { Placed } from '../net/topology.ts';

const MAX_LABEL = 40;

export function hostSettings(placed: Placed, h: Host, app: AfterChange & { retitle?: (title: string) => void }): HTMLElement {
  return livePanel((refresh) => {
    const label = input({ value: placed.label, maxlength: String(MAX_LABEL), 'aria-describedby': 'label-hint' });
    const hostname = input({ value: h.name, maxlength: '253' });
    const pretty = input({ value: h.prettyName ?? '', placeholder: 'Opcional, texto libre' });
    const msg = message();
    const save = (): void => {
      const name = hostname.value.trim();
      const err = validHostname(name);
      if (err) return msg.error(err);
      const shown = label.value.trim();
      if (!shown) return msg.error('El nombre visible no puede estar vacío.');
      placed.label = shown.slice(0, MAX_LABEL);
      h.prettyName = pretty.value.trim() || undefined;
      h.setHostname(name);
      app.retitle?.(placed.label);
      app.afterCommand();
      refresh();
      msg.ok(`Guardado. Nombre de host: ${name}.`);
    };
    const same = button('Usar el nombre visible', () => { hostname.value = label.value.trim().replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(); });
    return [
      el('h3', {}, 'Nombre del equipo'),
      el('div', { class: 'grid2' },
        field('Nombre visible (área de trabajo)', label, 'Solo identifica el icono; no cambia la red.'),
        field('Nombre de host', hostname, 'Lo envía el cliente DHCP (opción 12) y lo muestran el prompt, /etc/hostname y hostname.')),
      field('Nombre descriptivo (pretty hostname)', pretty, 'Solo en GNU/Linux: lo muestra hostnamectl.'),
      el('div', { class: 'actions' }, button('Guardar', save), same),
      msg.el,
      el('h3', {}, 'Equivalencias'),
      el('ul', { class: 'muted' },
        el('li', {}, 'GNU/Linux: sudo hostnamectl set-hostname NOMBRE (persistente) o sudo hostname NOMBRE (solo hasta reiniciar). bash muestra el nombre nuevo en una shell nueva (exec bash).'),
        el('li', {}, 'Windows: Configuración → Sistema → Cambiar el nombre de este equipo.'),
        el('li', {}, `Ahora mismo: estático «${h.name}»${h.transientName ? `, transitorio «${h.transientName}»` : ''}${h.prettyName ? `, descriptivo «${h.prettyName}»` : ''}.`)),
    ];
  });
}
