/**
 * Package subpath `@glopezca/netfix/topology` (PUBLIC-API.md §3.1, runtime-neutral). Re-exports are allowed in entry files
 * (P5). Importing `Topology` loads `net/topology.ts`, which fills the load-time registries (R7). Not imported by `ui/main.ts`.
 */
export { FILE_VERSION, validateFile, TopologyFileError } from '../net/topology-file.ts';
export type { TopologyFileErrorCode } from '../net/topology-file.ts';
export { Topology } from '../net/topology.ts';
export type { TopologyFile, DeviceRecord, PcRecord, ServerRecord, DeviceKind } from '../net/topology.ts';
export { EXAMPLES } from '../net/examples.ts';
export { LABS_ES } from '../i18n/es-ES/labs.ts';
