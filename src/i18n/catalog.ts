/**
 * Message catalogues. Spanish (es-ES) is the source: its keys define `MessageKey`, and every English file is
 * typed `Record<…Key, string>`, so a missing or extra translation is a compile error.
 */
import type { Locale } from './locale.ts';
import { APP_ES } from './es-ES/app.ts';
import { APP_EN } from './en-GB/app.ts';
import { CANVAS_ES } from './es-ES/canvas.ts';
import { CANVAS_EN } from './en-GB/canvas.ts';
import { PAGES_ES } from './es-ES/pages.ts';
import { PAGES_EN } from './en-GB/pages.ts';
import { MC_ES } from './es-ES/mc.ts';
import { MC_EN } from './en-GB/mc.ts';
import { HOST_ES } from './es-ES/host.ts';
import { HOST_EN } from './en-GB/host.ts';
import { DNS_ES } from './es-ES/dns.ts';
import { DNS_EN } from './en-GB/dns.ts';
import { ROUTER_ES } from './es-ES/router.ts';
import { ROUTER_EN } from './en-GB/router.ts';
import { FIREWALL_ES } from './es-ES/firewall.ts';
import { FIREWALL_EN } from './en-GB/firewall.ts';
import { VPN_ES } from './es-ES/vpn.ts';
import { VPN_EN } from './en-GB/vpn.ts';
import { APPS_ES } from './es-ES/apps.ts';
import { APPS_EN } from './en-GB/apps.ts';
import { LABS_ES } from './es-ES/labs.ts';
import { LABS_EN } from './en-GB/labs.ts';
import { CLOUD_ES } from './es-ES/cloud.ts';
import { CLOUD_EN } from './en-GB/cloud.ts';
import { UI_ES } from './es-ES/ui.ts';
import { UI_EN } from './en-GB/ui.ts';

import { SRV_ES } from './es-ES/srv.ts';
import { SRV_EN } from './en-GB/srv.ts';
import { WEB_ES } from './es-ES/web.ts';
import { WEB_EN } from './en-GB/web.ts';
import { LOAD_ES } from './es-ES/load.ts';
import { LOAD_EN } from './en-GB/load.ts';
import { IFACES_ES } from './es-ES/ifaces.ts';
import { IFACES_EN } from './en-GB/ifaces.ts';
import { DRAW_ES } from './es-ES/draw.ts';
import { DRAW_EN } from './en-GB/draw.ts';
import { UNDO_ES } from './es-ES/undo.ts';
import { UNDO_EN } from './en-GB/undo.ts';
import { ZONES_ES } from './es-ES/zones.ts';
import { ZONES_EN } from './en-GB/zones.ts';
import { DNSUI_ES } from './es-ES/dnsui.ts';
import { DNSUI_EN } from './en-GB/dnsui.ts';
const ES = { ...APP_ES, ...CANVAS_ES, ...PAGES_ES, ...MC_ES, ...HOST_ES, ...DNS_ES, ...ROUTER_ES, ...FIREWALL_ES, ...VPN_ES, ...APPS_ES, ...LABS_ES, ...UI_ES, ...CLOUD_ES, ...SRV_ES, ...WEB_ES, ...LOAD_ES, ...IFACES_ES, ...DRAW_ES, ...UNDO_ES, ...ZONES_ES, ...DNSUI_ES };

export type MessageKey = keyof typeof ES;

export const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  'es-ES': ES,
  'en-GB': { ...APP_EN, ...CANVAS_EN, ...PAGES_EN, ...MC_EN, ...HOST_EN, ...DNS_EN, ...ROUTER_EN, ...FIREWALL_EN, ...VPN_EN, ...APPS_EN, ...LABS_EN, ...UI_EN, ...CLOUD_EN, ...SRV_EN, ...WEB_EN, ...LOAD_EN, ...IFACES_EN, ...DRAW_EN, ...UNDO_EN, ...ZONES_EN, ...DNSUI_EN },
};
