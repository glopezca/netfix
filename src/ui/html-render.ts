/**
 * Renders HTML received from a simulated web server as a safe DOM subtree.
 * The markup is parsed with DOMParser (scripts never run there) and rebuilt element by element
 * from an allow-list; only text and the href of links are copied. No innerHTML, no styles, no scripts.
 */

const ALLOWED = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'a', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u',
  'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'section', 'article',
  'header', 'footer', 'main', 'nav', 'small', 'mark', 'dl', 'dt', 'dd', 'abbr',
]);
const SKIP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'noscript', 'template', 'svg', 'math', 'link', 'meta', 'head']);
const MAX_NODES = 5000;

export interface RenderedPage {
  readonly title: string;
  readonly body: DocumentFragment;
}

export function renderHtml(html: string, onLink: (href: string) => void): RenderedPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  let budget = MAX_NODES;
  const copy = (src: Node, dst: Node): void => {
    for (const child of Array.from(src.childNodes)) {
      if (budget-- <= 0) return;
      if (child.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (!ALLOWED.has(tag)) {
        copy(child, dst);
        continue;
      }
      const out = document.createElement(tag);
      if (tag === 'a') {
        const href = child.getAttribute('href') ?? '';
        out.setAttribute('href', '#');
        out.setAttribute('data-href', href);
        out.addEventListener('click', (e) => {
          e.preventDefault();
          onLink(href);
        });
      }
      copy(child, out);
      dst.appendChild(out);
    }
  };
  copy(doc.body ?? doc.documentElement, frag);
  return { title: doc.title, body: frag };
}

export { resolveLink } from '../web/url.ts';
