/**
 * Package subpath `@glopezca/netfix/classroom` (PUBLIC-API.md §3.2, runtime-neutral). Re-exports allowed by P5. The classes
 * (`WorkLimitError`, `Topology`) come from the same modules as `./topology`, so `instanceof` holds across subpaths (R8).
 */
export { allowsDevice, allowsLab, allowsTab, parseRestrictions, NO_RESTRICTIONS, DEVICE_KINDS } from '../classroom/restrictions.ts';
export type { Restrictions } from '../classroom/restrictions.ts';
export { checkFields, parseChecklist, registerCheckKind } from '../classroom/checklist.ts';
export { codeLab, CODE_LAB_DEVICE } from '../classroom/code-lab.ts';
export type { CodeLabFile } from '../classroom/code-lab.ts';
export type { Check, CheckField, CheckKind, CheckOutcome, ChecklistItem, ExtensionCheck } from '../classroom/checklist.ts';
export { evaluate, WORK_LIMIT, RUNTIME_INFO, EVALUATION_VERSION } from '../classroom/evaluate.ts';
export type { Evaluation, ItemResult, NetfixRuntimeInfo } from '../classroom/evaluate.ts';
export { evaluateFile } from '../classroom/embed.ts';
export { checkMarkingBudget, MARK_MAX_DEVICES, MARK_MAX_CONFIG_LINES } from '../classroom/budget.ts';
export { withWorkLimit, WorkLimitError } from '../net/network.ts';
import { registerRunCheck } from '../classroom/run-check.ts';
export { runOnHost } from '../classroom/host-run.ts';
export type { HostRun } from '../classroom/host-run.ts';

// S23: `run` is a registered type until it moves to Classroom's extension pack.
registerRunCheck();
