/**
 * Package subpath `@glopezca/netfix/ui` (PUBLIC-API.md §3.3, browser only). Importing it runs `ui/boot.ts`: it installs
 * `globalThis.netfix` (`embed`, `evaluate`) and starts the standalone app on `#app` unless that mount has `data-embed`.
 */
import '../ui/boot.ts';
export type { EmbedHandle, ChangeListener } from '../classroom/embed.ts';
export type { NetfixApi } from '../ui/embed-api.ts';
export type { ClassLanChooser, ClassLanClass, ClassLanLink, ClassLanMessage } from '../net/classlan.ts';
