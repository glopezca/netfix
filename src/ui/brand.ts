/** Netfix corporate images in the app: favicon, CSS variables (doc bullets, web GUIs) and <img> helpers. */
import { el } from './dom.ts';
import { BRAND } from './brand-data.ts';
import type { BrandImages } from './brand-data.ts';

/** The images as CSS custom properties: [property, image]. */
const BRAND_VARS = [['--brand-logo', 'logo'], ['--brand-isologo-n', 'isologoN'], ['--brand-isologo', 'isologo'], ['--brand-diamond', 'diamond']] as const;

/**
 * Exposes the images as CSS custom properties on Netfix's mount (doc bullets, web GUIs); on its own page (`page`),
 * also its favicon. Embedded, the host's <html> and icon are the host's (C5).
 */
export function applyBrand(mount: HTMLElement, page: boolean): void {
  for (const [prop, kind] of BRAND_VARS) mount.style.setProperty(prop, `url("${BRAND[kind]}")`);
  if (!page) return;
  const doc = mount.ownerDocument;
  const icon = doc.querySelector('link[rel="icon"]') ?? doc.head.appendChild(el('link', { rel: 'icon', type: 'image/png' }));
  icon.setAttribute('href', BRAND.favicon);
  const touch = doc.querySelector('link[rel="apple-touch-icon"]') ?? doc.head.appendChild(el('link', { rel: 'apple-touch-icon' }));
  touch.setAttribute('href', BRAND.appleTouchIcon);
}

/** Takes the custom properties off the mount again (the host gets its element back as it was). */
export function removeBrand(mount: HTMLElement): void {
  for (const [prop] of BRAND_VARS) mount.style.removeProperty(prop);
}

export function brandImage(kind: keyof BrandImages, cls: string, alt: string): HTMLImageElement {
  return el('img', { src: BRAND[kind], class: cls, alt, decoding: 'async' });
}
