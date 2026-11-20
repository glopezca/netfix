/**
 * Package subpath `@glopezca/netfix/ui` (PUBLIC-API.md §3.3, browser only). Importing it runs `ui/boot.ts`: it installs
 * `globalThis.netfix` (`embed`, `evaluate`) and starts the standalone app on `#app` unless that mount has `data-embed`.
 * `registerHostOption` (S23) adds an extension's option to `netfix.embed` and `netfix.lab` for one of its device kinds.
 */
import '../ui/boot.ts';
export { registerHostOption } from '../ui/host-options.ts';
export type { HostOptionSpec, KindHost } from '../ui/host-options.ts';
export type { EmbedHandle, ChangeListener } from '../classroom/embed.ts';
export type { NetfixApi } from '../ui/embed-api.ts';
export type { CodeHandle } from '../ui/code-mount.ts';
export type { ClassLanChooser, ClassLanClass, ClassLanLink, ClassLanMessage } from '../net/classlan.ts';
