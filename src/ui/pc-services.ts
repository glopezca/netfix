/**
 * Servicios of a GNU/Linux PC: the kernel parameters and the configuration files always, and what apt's packages
 * bring (net/pkg-units.ts → hostPanels): the nftables firewall, Samba, and the logs of either. A PC has no web GUI (no
 * HTTP server): everything else is done in its terminal.
 */
import { t } from '../i18n/t.ts';
import { subnav } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Host } from '../devices/host.ts';
import { firewallPanel, sysctlPanel } from './firewall-panel.ts';
import { sambaPanel } from './samba-panel.ts';
import { filesPanel } from './files-panel.ts';
import { logPanel, packageLogUnits } from './log-panel.ts';

/** `panels`: hostPanels(host), in that order. */
export function pcServicesTab(host: Host, app: AfterChange, panels: readonly string[]): HTMLElement {
  const all = [
    { id: 'sysctl', label: t('sysctl.tab'), render: () => sysctlPanel(host, app).root },
    { id: 'firewall', label: t('fw.tab'), render: () => firewallPanel(host, app).root },
    { id: 'samba', label: t('smb.tab'), render: () => sambaPanel(host, app).root },
    { id: 'files', label: t('srv.files'), render: () => filesPanel(host, 'sysctl') },
    { id: 'log', label: t('srv.log'), render: () => logPanel(host, () => packageLogUnits(host), t('pcsvc.journalHint')) },
  ];
  return subnav(all.filter((p) => panels.includes(p.id)));
}
