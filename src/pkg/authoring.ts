/**
 * Package subpath `@glopezca/netfix/authoring` (runtime-neutral, light): what an editor of restrictions, checklists and
 * lab choices needs without loading the simulator. Re-exports allowed by P5. Same modules as `./classroom` and
 * `./topology`, so values are identical across subpaths. `pack-check` keeps its import graph free of the simulator.
 */
export { allowsDevice, allowsLab, allowsTab, parseRestrictions, NO_RESTRICTIONS, DEVICE_KINDS } from '../classroom/restrictions.ts';
export type { Restrictions } from '../classroom/restrictions.ts';
export { checkFields, parseChecklist, registerCheckKind } from '../classroom/checklist.ts';
export type { Check, CheckField, CheckKind, CheckOutcome, ChecklistItem, ExtensionCheck } from '../classroom/checklist.ts';
export { LABS_ES } from '../i18n/es-ES/labs.ts';
export type { DeviceKind } from '../net/topology.ts';
export { declareDeviceKind, deviceKinds } from '../net/device-kinds.ts';
