/**
 * The units of Servicios → Registros of a Server or GNU/Linux router: only those of the services installed on it (its
 * box on in the Configuración tab), in the order of the Services tab; postfix and dovecot go with the mail box.
 */
import type { AppsDevice } from '../net/device-apps.ts';
import { appAvailable } from '../net/device-apps.ts';
import type { FeatureId } from '../net/lab-features.ts';
import type { UnitInfo } from './units.ts';
import { logUnits } from './units.ts';

/** The box of each unit (smtp and mailbox are the mail box). */
const FEATURE: Readonly<Record<string, FeatureId>> = { smtp: 'mail', mailbox: 'mail' };

/** A stopped service stays listed (its journal says why it stopped), as on a real system. */
export function installedLogUnits(d: AppsDevice): UnitInfo[] {
  return logUnits(d.kind).filter((u) => appAvailable(d, FEATURE[u.id] ?? (u.id as FeatureId)));
}
