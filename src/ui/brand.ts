/** Netfix corporate images in the app: favicon, CSS variables (doc bullets, web GUIs) and <img> helpers. */
import { el } from './dom.ts';
import { BRAND } from './brand-data.ts';
import type { BrandImages } from './brand-data.ts';

/** Exposes the images as CSS custom properties and sets the favicon (once, at start-up). */
export function applyBrand(doc: Document = document): void {
  const root = doc.documentElement.style;
  root.setProperty('--brand-logo', `url("${BRAND.logo}")`);
  root.setProperty('--brand-isologo-n', `url("${BRAND.isologoN}")`);
  root.setProperty('--brand-isologo', `url("${BRAND.isologo}")`);
  root.setProperty('--brand-diamond', `url("${BRAND.diamond}")`);
  const icon = doc.querySelector('link[rel="icon"]') ?? doc.head.appendChild(el('link', { rel: 'icon', type: 'image/png' }));
  icon.setAttribute('href', BRAND.favicon);
  const touch = doc.querySelector('link[rel="apple-touch-icon"]') ?? doc.head.appendChild(el('link', { rel: 'apple-touch-icon' }));
  touch.setAttribute('href', BRAND.appleTouchIcon);
}

export function brandImage(kind: keyof BrandImages, cls: string, alt: string): HTMLImageElement {
  return el('img', { src: BRAND[kind], class: cls, alt, decoding: 'async' });
}
