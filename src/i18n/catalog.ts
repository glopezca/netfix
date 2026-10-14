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

const ES = { ...APP_ES, ...CANVAS_ES, ...PAGES_ES, ...MC_ES, ...HOST_ES, ...DNS_ES, ...ROUTER_ES, ...FIREWALL_ES, ...VPN_ES };

export type MessageKey = keyof typeof ES;

export const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  'es-ES': ES,
  'en-GB': { ...APP_EN, ...CANVAS_EN, ...PAGES_EN, ...MC_EN, ...HOST_EN, ...DNS_EN, ...ROUTER_EN, ...FIREWALL_EN, ...VPN_EN },
};
