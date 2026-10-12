/** URL helpers shared by curl and the browser. */

/** Resolves a link found in a page against the page's URL ("ayuda.html", "/x", "../y", "?q=1", "http://h/y"). */
export function resolveLink(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const m = /^(https?:\/\/)?([^/?#]+)([^?#]*)/i.exec(base);
  const origin = `${m?.[1] ?? 'http://'}${m?.[2] ?? ''}`;
  const basePath = m?.[3] || '/';
  if (href.startsWith('//')) return `http:${href}`;
  if (href.startsWith('?')) return `${origin}${basePath}${href}`;
  if (href.startsWith('#') || href === '') return `${origin}${basePath}`;
  const joined = href.startsWith('/') ? href : `${basePath.replace(/[^/]*$/, '')}${href}`;
  const [pathPart = '', rest = ''] = joined.split(/(?=[?#])/, 2);
  const out: string[] = [];
  for (const seg of pathPart.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  const trailing = /\/(\.\.?)?$/.test(pathPart) && out.length > 0 ? '/' : '';
  return `${origin}/${out.join('/')}${trailing}${rest}`;
}
