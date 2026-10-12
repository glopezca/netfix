/**
 * Renders HTML received from a simulated web server as a safe DOM subtree.
 * The markup is parsed with DOMParser (scripts never run there) and rebuilt element by element
 * from an allow-list: text, links, forms and a few attributes are copied; classes only from the
 * `web-` namespace (styled by the app inside the browser view). No innerHTML, no styles, no scripts.
 */

const ALLOWED = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'a', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div', 'span', 'section', 'article',
  'header', 'footer', 'main', 'nav', 'aside', 'small', 'mark', 'dl', 'dt', 'dd', 'abbr', 'address', 'details', 'summary',
  'form', 'input', 'select', 'option', 'textarea', 'button', 'label', 'fieldset', 'legend',
]);
const SKIP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'link', 'meta', 'head', 'frame', 'frameset', 'base']);
const INPUT_TYPES = new Set(['text', 'password', 'hidden', 'checkbox', 'radio', 'submit', 'email', 'number', 'search', 'url', 'tel', 'reset']);
const ATTRS: Readonly<Record<string, readonly string[]>> = {
  input: ['name', 'value', 'placeholder', 'size', 'maxlength', 'min', 'max'],
  select: ['name'], option: ['value'], textarea: ['name', 'rows', 'cols', 'placeholder'], button: ['name', 'value'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
};
const BOOL_ATTRS = ['checked', 'selected', 'readonly', 'disabled'];
const MAX_NODES = 5000;
const CLASS = /^web-[a-z0-9-]+$/;

export interface RenderedPage {
  readonly title: string;
  readonly body: DocumentFragment;
}

export interface PageActions {
  link(href: string): void;
  submit(action: string, method: 'GET' | 'POST', fields: [string, string][]): void;
}

function copyAttributes(src: Element, out: HTMLElement, tag: string): void {
  const cls = (src.getAttribute('class') ?? '').split(/\s+/).filter((c) => CLASS.test(c));
  if (cls.length) out.className = cls.join(' ');
  const title = src.getAttribute('title');
  if (title) out.title = title;
  for (const name of ATTRS[tag] ?? []) {
    const v = src.getAttribute(name);
    if (v !== null) out.setAttribute(name, v.slice(0, 2048));
  }
  for (const name of BOOL_ATTRS) if (src.hasAttribute(name)) out.setAttribute(name, '');
  if (tag === 'input') {
    const type = (src.getAttribute('type') ?? 'text').toLowerCase();
    out.setAttribute('type', INPUT_TYPES.has(type) ? type : 'text');
    // simulated logins must not reach the real browser's password manager
    out.setAttribute('autocomplete', type === 'password' ? 'new-password' : 'off');
  }
  if (tag === 'button') out.setAttribute('type', (src.getAttribute('type') ?? 'submit').toLowerCase() === 'button' ? 'button' : 'submit');
}

function wireForm(src: Element, form: HTMLFormElement, actions: PageActions): void {
  const action = src.getAttribute('action') ?? '';
  const method = (src.getAttribute('method') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  form.noValidate = true;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const submitter = (e as SubmitEvent).submitter ?? null;
    const fields: [string, string][] = [];
    new FormData(form, submitter).forEach((v, k) => { if (typeof v === 'string') fields.push([k, v]); });
    actions.submit(action, method, fields);
  });
}

export function renderHtml(html: string, actions: PageActions | ((href: string) => void)): RenderedPage {
  const act: PageActions = typeof actions === 'function' ? { link: actions, submit: () => undefined } : actions;
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
      copyAttributes(child, out, tag);
      if (tag === 'a') {
        const href = child.getAttribute('href') ?? '';
        out.setAttribute('href', '#');
        out.setAttribute('data-href', href);
        out.addEventListener('click', (e) => {
          e.preventDefault();
          act.link(href);
        });
      }
      if (tag === 'form') wireForm(child, out as HTMLFormElement, act);
      copy(child, out);
      if (tag === 'textarea') (out as HTMLTextAreaElement).value = child.textContent ?? '';
      dst.appendChild(out);
    }
  };
  const root = doc.body ?? doc.documentElement;
  const bodyClass = (root.getAttribute('class') ?? '').split(/\s+/).filter((c) => CLASS.test(c));
  // the <body> classes (the look of a web app) go on a wrapper inside the browser view
  const holder = bodyClass.length ? frag.appendChild(Object.assign(document.createElement('div'), { className: bodyClass.join(' ') })) : frag;
  copy(root, holder);
  return { title: doc.title, body: frag };
}

