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

// Extension SDK (S23, PUBLIC-API.md §3.5): a registered kind's look and window, built with the core's own widgets.
export { registerDeviceUi, deviceUi } from '../ui/device-kind-ui.ts';
// The device context menu (S24 of FixIT Classroom): an extension's entries after Abrir.
export { registerDeviceAction } from '../ui/device-menu.ts';
export type { DeviceAction } from '../ui/device-menu.ts';
export type { DeviceUi, DeviceWindowContext } from '../ui/device-kind-ui.ts';
export type { Tab } from '../ui/windows.ts';
export { el, uiRoot } from '../ui/dom.ts';
export { button, field, input, message, onCommit } from '../ui/forms.ts';
export { livePanel } from '../ui/server-dhcp-dns.ts';
export { forwardsSection } from '../ui/cloud-window.ts';
export { Terminal } from '../ui/terminal.ts';
export { checkMount } from '../ui/embed-api.ts';
export { getLocale, onLocaleChange } from '../i18n/locale.ts';
// The missions' school and teacher (FixIT Classroom: the organisation and the class's teacher).
export { setMissionChapters, setStoryNames } from '../labs/story.ts';
export type { StoryNames } from '../labs/story.ts';
export type { Locale } from '../i18n/locale.ts';
