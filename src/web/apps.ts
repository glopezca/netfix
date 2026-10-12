/** Connects the simulated web applications to the Server-PT web service and the IOS HTTP server. */
import { registerWebApp } from '../devices/server-web.ts';
import { roundcube } from './roundcube.ts';
import { serverAdmin } from './server-admin.ts';
import { registerIosWeb } from '../devices/ios-web.ts';
import { iosWeb } from './ios-web.ts';

export function registerWebApps(): void {
  registerWebApp('roundcube', roundcube);
  registerWebApp('admin', serverAdmin);
  registerIosWeb(iosWeb);
}
