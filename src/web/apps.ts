/** Connects the simulated web applications to the Server-PT web service. */
import { registerWebApp } from '../devices/server-web.ts';
import { roundcube } from './roundcube.ts';
import { serverAdmin } from './server-admin.ts';

export function registerWebApps(): void {
  registerWebApp('roundcube', roundcube);
  registerWebApp('admin', serverAdmin);
}
