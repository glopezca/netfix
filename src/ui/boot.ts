/**
 * Netfix's page entry (the build starts here): publishes `globalThis.netfix` and starts the standalone app on `#app`
 * unless that mount has `data-embed`. `ui/main.ts` only defines, so a host can mount Netfix without an iframe (R7).
 */
import { NETFIX_API, startStandalone } from './main.ts';
import { installApi } from './embed-api.ts';

installApi(NETFIX_API);
const mount = document.getElementById('app');
if (mount && mount.dataset.embed === undefined) startStandalone(mount);
