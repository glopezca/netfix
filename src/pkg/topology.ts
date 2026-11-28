/**
 * Package subpath `@glopezca/netfix/topology` (PUBLIC-API.md §3.1, runtime-neutral). Re-exports are allowed in entry files
 * (P5). Importing `Topology` loads `net/topology.ts`, which fills the load-time registries (R7). Not imported by `ui/main.ts`.
 */
export { FILE_VERSION, validateFile, TopologyFileError } from '../net/topology-file.ts';
export type { TopologyFileErrorCode } from '../net/topology-file.ts';
export { Topology } from '../net/topology.ts';
export type { TopologyFile, DeviceRecord, PcRecord, ServerRecord, DeviceKind } from '../net/topology.ts';
export { EXAMPLES } from '../net/examples.ts';
export type { Example } from '../net/examples.ts';
// Labs of an extension (0.99.0): a lab and its mission, built with the classes below.
export { registerLab } from '../labs/extension-labs.ts';
export type { ExtensionLab } from '../labs/extension-labs.ts';
export { missionById } from '../labs/missions.ts';
export type { Mission } from '../labs/missions.ts';
export type { MissionItem } from '../labs/mission-plans.ts';
export type { LabGroupId } from '../labs/lab-groups.ts';
export type { Server } from '../devices/server.ts';
export type { Pc } from '../devices/pc.ts';
export type { Switch } from '../devices/switch.ts';
export { LABS_ES } from '../i18n/es-ES/labs.ts';
export { declareDeviceKind, deviceKinds, registerDeviceKind } from '../net/device-kinds.ts';
export type { BuiltinDeviceKind, DeviceKindDef, ExtensionDevice } from '../net/device-kinds.ts';

// Extension SDK (S23): what a device kind or a code lab built outside the core uses (PUBLIC-API.md §3.5). Same modules as
// the core's own devices, so classes and the simulation are shared with every other subpath.
export { deviceKindDef } from '../net/device-kinds.ts';
export type { NetDevice } from '../net/network.ts';
export type { Frame, IpPacket } from '../net/packets.ts';
export type { SimClock } from '../core/clock.ts';
export { macFromSeed } from '../core/mac.ts';
export { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';
export { DETACHED, macPlus } from '../devices/hooks.ts';
export type { DeviceHooks } from '../devices/hooks.ts';
export { CloudPort } from '../devices/cloud-port.ts';
export { defaultPort, portFromJson, portToJson, validatePort } from '../devices/cloud-config.ts';
export type { CloudPortSettings } from '../devices/cloud-config.ts';
export { Host } from '../devices/host.ts';
export type { HostOs } from '../devices/host.ts';
export type { Cred, Vfs } from '../bash/vfs.ts';
export { createShell, defaultUser } from '../shells/factory.ts';
// Terminal programs of an extension (S24 of FixIT Classroom): /usr/bin or %PATH%, with the user's permissions.
export { registerProgram } from '../shells/programs.ts';
export type { FileEntry, HostFiles, ProgramCall, ProgramDef, ProgramDoc, ProgramSystem } from '../shells/programs.ts';
export { hostFiles } from '../shells/host-files.ts';
export { defaultLinuxUser, hostSystem, hostUsers } from '../shells/host-system.ts';
export { windowsAccount } from '../shells/win-system.ts';
