/**
 * The Classroom LAN as a registered device kind (S23): created, saved, loaded and joined to the host's link through
 * net/device-kinds.ts, as an extension pack does. It moves to FixIT Classroom's pack in S23 phase 2; until then the
 * package entries and the app register it.
 */
import { deviceKindDef, registerDeviceKind } from '../net/device-kinds.ts';
import type { ClassLanLink } from '../net/classlan.ts';
import { ClassLan, classLanFromJson, classLanToJson } from './classlan.ts';

export const CLASSLAN_KIND = 'classlan';
const TABS = ['classlan'];

/** The host's link (validated where the host gives it: ui/lan-chooser.ts); anything else is no link. */
function linkOf(v: unknown): ClassLanLink | null {
  const o = typeof v === 'object' && v !== null ? (v as Partial<ClassLanLink>) : null;
  return o && typeof o.lab === 'number' && typeof o.send === 'function' && typeof o.onMessage === 'function' ? (o as ClassLanLink) : null;
}

/** The whole kind, once (several entry points may call it). */
export function registerClassLanKind(): void {
  if (deviceKindDef(CLASSLAN_KIND)) return;
  registerDeviceKind(CLASSLAN_KIND, {
    prefix: 'ClassLAN',
    tabs: TABS,
    create: (o) => new ClassLan({ ...o }),
    save: (d) => (d instanceof ClassLan ? classLanToJson(d.settings) : {}),
    load: (d, data) => { if (d instanceof ClassLan) d.setSettings(classLanFromJson(data)); },
    connect: (d, context) => { if (d instanceof ClassLan) d.connect(linkOf(context)); },
    // The device is called as the host's class (one per lab).
    label: (context) => linkOf(context)?.name || undefined,
  });
}
