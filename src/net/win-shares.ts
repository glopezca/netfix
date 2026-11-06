/**
 * «Compartir archivos e impresoras para redes Microsoft» on Windows (PC and Server): the binding of the Server service
 * to the adapter, which the device's Configuración box ticks (unticked in each device; the lab's «winshare» feature
 * decides whether the box is there), and the shares it publishes. As with «uso compartido con protección por
 * contraseña» turned off: each share has a name, a folder of drive C:, a comment and what Everyone may do (read, or
 * full control). Kept beside the device in a weak registry and saved with it; a record from a file is checked as if
 * typed.
 */
import { featureOn } from './lab-features.ts';
import { hasSystem, labViewOf, notifyAppsChange } from './device-apps.ts';
import type { AppsDevice } from './device-apps.ts';

export type ShareAccess = 'read' | 'full';

export interface WinShare {
  readonly name: string;
  /** C:\folder (C:\ is the root of the device's file system). */
  readonly path: string;
  readonly remark: string;
  readonly access: ShareAccess;
}

/** Why a share was refused (the panel and `net share` word it). */
export type ShareError = 'name' | 'reserved' | 'exists' | 'path' | 'remark' | 'full';

/** What Windows allows: a share name of up to 80 characters, a comment of 256 and a path of MAX_PATH. */
const MAX_NAME = 80;
const MAX_REMARK = 256;
const MAX_PATH = 260;
/** More than a lab needs, and a bound on a crafted file. */
export const MAX_SHARES = 32;

/** Control characters (C0, DEL, C1) and the invisible or bidi ones that make one name look like another. */
const HIDDEN = '\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff';
/** Characters a share name cannot have (as Windows: " / \ [ ] : | < > + = ; , ? *), nor hidden ones. */
const BAD_NAME = new RegExp(`["/\\\\[\\]:|<>+=;,?*${HIDDEN}]`);
const BAD_REMARK = new RegExp(`[${HIDDEN}]`);
/** The administrative shares Windows keeps for itself. */
const RESERVED = /^(?:IPC|ADMIN|PRINT|[A-Z])\$$/i;
/** Characters a folder name cannot have. */
const BAD_SEGMENT = /[<>:"/|?*\u0000-\u001f\u007f]/;

interface ShareState {
  readonly on: boolean;
  readonly shares: readonly WinShare[];
}

const NONE: ShareState = { on: false, shares: [] };
const states = new WeakMap<object, ShareState>();
const stateOf = (d: object): ShareState => states.get(d) ?? NONE;

/** C:\a\b tidied (upper-case drive, no trailing \), or undefined when it is not a plain folder of drive C:. */
export function sharePath(path: string): string | undefined {
  if (path.length > MAX_PATH || !/^[cC]:\\/.test(path)) return undefined;
  const typed = path.slice(3).split('\\');
  if (typed.at(-1) === '') typed.pop();
  // Win32 drops the dots and spaces that end a name (so «docs.» is docs, and «. .» is nothing).
  const parts = typed.map((p) => p.replace(/[. ]+$/, ''));
  if (parts.some((p) => p === '' || BAD_SEGMENT.test(p))) return undefined;
  return `C:\\${parts.join('\\')}`;
}

/** The share as it would be kept, or why not (beside the shares already there). */
function checkShare(shares: readonly WinShare[], s: WinShare): WinShare | ShareError {
  if (!s.name || s.name.length > MAX_NAME || s.name.trim() !== s.name || BAD_NAME.test(s.name)) return 'name';
  if (RESERVED.test(s.name)) return 'reserved';
  if (shares.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) return 'exists';
  const path = sharePath(s.path);
  if (path === undefined) return 'path';
  if (s.remark.length > MAX_REMARK || BAD_REMARK.test(s.remark)) return 'remark';
  if (shares.length >= MAX_SHARES) return 'full';
  return { name: s.name, path, remark: s.remark, access: s.access === 'full' ? 'full' : 'read' };
}

/** The box of the device's Configuración tab: a device with Windows (its terminal) whose lab keeps the feature. */
export function winShareOffered(d: AppsDevice): boolean {
  return hasSystem(d, 'windows') && featureOn(labViewOf(d).features, d.kind, 'winshare');
}

/** The box ticked (whether or not the lab still offers it). */
export function winShareOn(d: AppsDevice): boolean {
  return stateOf(d).on;
}

/** File and printer sharing working: the box ticked on a device that offers it (SMB on 139/445, NAME<20>). */
export function winShareActive(d: AppsDevice): boolean {
  return winShareOn(d) && winShareOffered(d);
}

export function setWinShareOn(d: AppsDevice, on: boolean): void {
  if (winShareOn(d) === on) return;
  states.set(d, { ...stateOf(d), on });
  notifyAppsChange(d);
}

export function winShares(d: AppsDevice): readonly WinShare[] {
  return stateOf(d).shares;
}

export function findWinShare(d: AppsDevice, name: string): WinShare | undefined {
  return winShares(d).find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/** Publishes a share: undefined when done, or why not. */
export function addWinShare(d: AppsDevice, share: WinShare): ShareError | undefined {
  const state = stateOf(d);
  const checked = checkShare(state.shares, share);
  if (typeof checked === 'string') return checked;
  states.set(d, { ...state, shares: [...state.shares, checked] });
  return undefined;
}

/** Stops sharing (the folder stays): whether there was such a share. */
export function removeWinShare(d: AppsDevice, name: string): boolean {
  const state = stateOf(d);
  const rest = state.shares.filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  if (rest.length === state.shares.length) return false;
  states.set(d, { ...state, shares: rest });
  return true;
}

/** What the file keeps: nothing while the box is unticked and there are no shares. */
export function winSharesRecord(d: AppsDevice): { readonly on: boolean; readonly shares: readonly WinShare[] } | undefined {
  const state = stateOf(d);
  return state.on || state.shares.length ? { on: state.on, shares: state.shares } : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A share of a file (untrusted): every field of the right type and accepted as if typed. */
function shareOf(v: unknown): WinShare | undefined {
  if (!isObj(v) || typeof v.name !== 'string' || typeof v.path !== 'string' || typeof v.remark !== 'string') return undefined;
  if (v.access !== 'read' && v.access !== 'full') return undefined;
  return { name: v.name, path: v.path, remark: v.remark, access: v.access };
}

/** Puts the `winShare` of a file back: the box only when `on` is true, the shares that pass the checks. */
export function restoreWinShares(d: AppsDevice, data: unknown): void {
  if (!isObj(data)) return;
  const list = Array.isArray(data.shares) ? data.shares.slice(0, MAX_SHARES * 2) : [];
  const shares = list.reduce<WinShare[]>((kept, v) => {
    const s = shareOf(v);
    const checked = s && checkShare(kept, s);
    return checked && typeof checked !== 'string' ? [...kept, checked] : kept;
  }, []);
  states.set(d, { on: data.on === true, shares });
}
