/**
 * Diagrams of the documentation, drawn from data: a topology with the palette icons (cables with their labels) and a
 * sequence of messages between actors (DORA, a DNS query…). Text always through textContent.
 */
import { el, svg, staticSvg } from './dom.ts';
import { ICONS, ICON_W, ICON_H } from './icons.ts';
import type { Figure, FigNode } from '../docs/types.ts';

/** The 0-100 × 0-60 grid of a topology, in SVG units. */
const UNIT = 5;
const PAD = 40;
const SEQ_COL = 320;
const SEQ_ROW = 52;
const SEQ_TOP = 46;
/** Room on both sides of a sequence for the actors' names and the notes. */
const SEQ_PAD = 150;
/** Room at the edge beyond the widest text. */
const EDGE = 8;
/** Approximate advance of the label (14 px bold) and of the note (12 px monospace). */
const LABEL_CHAR = 8.5;
const NOTE_CHAR = 7.3;

type Topology = Extract<Figure, { type: 'topology' }>;
type Sequence = Extract<Figure, { type: 'sequence' }>;

const at = (n: FigNode): { x: number; y: number } => ({ x: PAD + n.x * UNIT, y: PAD + n.y * UNIT });

function node(n: FigNode): SVGGElement {
  const { x, y } = at(n);
  const icon = staticSvg(ICONS[n.kind]);
  icon.setAttribute('x', String(x - ICON_W / 2));
  icon.setAttribute('y', String(y - ICON_H / 2));
  return svg('g', { class: `doc-fig-node doc-fig-${n.kind}` }, icon,
    svg('text', { x, y: y + ICON_H / 2 + 16, class: 'doc-fig-label' }, n.label),
    n.note ? svg('text', { x, y: y + ICON_H / 2 + 31, class: 'doc-fig-note' }, n.note) : '');
}

function topology(f: Topology): SVGSVGElement {
  const byId = new Map(f.nodes.map((n) => [n.id, n]));
  const links = f.links.flatMap((l) => {
    const [a, b] = [byId.get(l.a), byId.get(l.b)];
    if (!a || !b) return [];
    const [p, q] = [at(a), at(b)];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    return [svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: 'doc-fig-cable' }),
      l.label ? svg('text', { x: mid.x, y: mid.y - 6, class: 'doc-fig-cable-label' }, l.label) : ''];
  });
  // Widened when a label or a note is longer than the margin, so no text is cut at the edges.
  const left = Math.floor(Math.min(0, ...f.nodes.map((n) => at(n).x - halfWidth(n) - EDGE)));
  const right = Math.ceil(Math.max(...f.nodes.map((n) => Math.max(at(n).x + PAD + ICON_W / 2, at(n).x + halfWidth(n) + EDGE))));
  const w = right - left;
  const h = Math.max(...f.nodes.map((n) => at(n).y)) + PAD + ICON_H / 2 + 20;
  // Drawn at its own size (never enlarged): icons and texts keep the size they have on the workspace.
  return svg('svg', { viewBox: `${left} 0 ${w} ${h}`, width: w, height: h, class: 'doc-fig-svg', role: 'img' }, ...links, ...f.nodes.map(node));
}

/** Half the width of a node: its icon, its label or its note, whichever is widest. */
function halfWidth(n: FigNode): number {
  return Math.max(ICON_W / 2, (n.label.length * LABEL_CHAR) / 2, ((n.note?.length ?? 0) * NOTE_CHAR) / 2);
}

function sequence(f: Sequence): SVGSVGElement {
  const x = (i: number): number => SEQ_PAD + i * SEQ_COL;
  const h = SEQ_TOP + (f.messages.length + 1) * SEQ_ROW;
  const heads = f.actors.flatMap((a, i) => [
    svg('text', { x: x(i), y: 22, class: 'doc-fig-actor' }, a),
    svg('line', { x1: x(i), y1: 32, x2: x(i), y2: h - 10, class: 'doc-fig-life' }),
  ]);
  const msgs = f.messages.flatMap((m, i) => {
    const y = SEQ_TOP + (i + 1) * SEQ_ROW;
    const [a, b] = [x(m.from), x(m.to)];
    const dir = Math.sign(b - a) || 1;
    return [
      svg('line', { x1: a, y1: y, x2: b - dir * 8, y2: y, class: 'doc-fig-msg' }),
      svg('path', { d: `M${b} ${y} l${-dir * 10} -5 v10 z`, class: 'doc-fig-arrow' }),
      svg('text', { x: (a + b) / 2, y: y - 8, class: 'doc-fig-msg-label' }, `${i + 1}. ${m.text}`),
      m.note ? svg('text', { x: (a + b) / 2, y: y + 15, class: 'doc-fig-note' }, m.note) : '',
    ];
  });
  const w = x(f.actors.length - 1) + SEQ_PAD;
  return svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'doc-fig-svg doc-fig-seq', role: 'img' }, ...heads, ...msgs);
}

export function docFigure(f: Figure, caption: string): HTMLElement {
  const drawing = f.type === 'topology' ? topology(f) : sequence(f);
  // Screen readers get what the drawing says, not only its caption.
  const said = f.type === 'topology' ? f.nodes.map((n) => [n.label, n.note].filter(Boolean).join(' ')) : f.messages.map((m) => `${f.actors[m.from] ?? ''} → ${f.actors[m.to] ?? ''}: ${m.text}`);
  drawing.setAttribute('aria-label', `${caption} ${said.join('; ')}`);
  return el('figure', { class: 'doc-figure' }, drawing, el('figcaption', {}, caption));
}
