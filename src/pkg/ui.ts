/**
 * Package subpath `@glopezca/netfix/ui` (PUBLIC-API.md §3.3, browser only). Importing it runs `ui/main.ts`: it installs
 * `globalThis.netfix` (`embed`, `evaluate`) and starts the standalone app on `#app` unless that mount has `data-embed`.
 */
import '../ui/main.ts';
export type { EmbedHandle, ChangeListener } from '../classroom/embed.ts';
export type { NetfixApi } from '../ui/embed-api.ts';
