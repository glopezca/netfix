/**
 * Core entry for Node/Workers (PUBLIC-API.md §3: the Phase 2 contracts; D3 keeps today's names). Re-exports are allowed
 * here by P5 (entry files only). Importing `Topology` loads `net/topology.ts`, which fills the load-time registries (R7).
 * Not imported by `ui/main.ts`, so the standalone build is unchanged.
 */
export { FILE_VERSION, validateFile, TopologyFileError } from '../net/topology-file.ts';
export type { TopologyFileErrorCode } from '../net/topology-file.ts';
export { Topology } from '../net/topology.ts';
export type { TopologyFile, DeviceRecord, PcRecord, ServerRecord, DeviceKind } from '../net/topology.ts';
export { EXAMPLES } from '../net/examples.ts';
export { LABS_ES } from '../i18n/es-ES/labs.ts';
export { allowsDevice, allowsLab, allowsTab, parseRestrictions, NO_RESTRICTIONS, DEVICE_KINDS } from '../classroom/restrictions.ts';
export type { Restrictions } from '../classroom/restrictions.ts';
export { parseChecklist } from '../classroom/checklist.ts';
export type { Check, ChecklistItem } from '../classroom/checklist.ts';
export { evaluate, WORK_LIMIT, RUNTIME_INFO, EVALUATION_VERSION } from '../classroom/evaluate.ts';
export type { Evaluation, ItemResult, NetfixRuntimeInfo } from '../classroom/evaluate.ts';
export { evaluateFile } from '../classroom/embed.ts';
export { checkMarkingBudget, MARK_MAX_DEVICES, MARK_MAX_CONFIG_LINES } from '../classroom/budget.ts';
export { withWorkLimit, WorkLimitError } from '../net/network.ts';
