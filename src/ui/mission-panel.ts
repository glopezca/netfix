/**
 * Guided lab panel beside the workspace: the client's ticket, what the lab is for, the tasks with their hints (shown
 * one level at a time and saved with the network), Check against the mission's rubric and View solution.
 * Every text goes through textContent; the result details may quote what the student typed.
 */
import { el, clear } from './dom.ts';
import { button } from './forms.ts';
import { confirmDialog } from './confirm-dialog.ts';
import { labText } from './lab-text.ts';
import { t, tDynamic } from '../i18n/t.ts';
import type { Topology } from '../net/topology.ts';
import { EXAMPLES } from '../net/examples.ts';
import { LAB_GROUPS } from '../labs/lab-groups.ts';
import { missionById } from '../labs/missions.ts';
import type { Mission } from '../labs/missions.ts';
import { hintKey, missionRubric, taskKey } from '../labs/mission-build.ts';
import { HINT_LEVELS } from '../labs/mission-plans.ts';
import { withHint } from '../labs/mission-state.ts';
import { findPage } from '../docs/index.ts';
import { evaluate } from '../classroom/evaluate.ts';
import type { Evaluation } from '../classroom/evaluate.ts';
import type { Restrictions } from '../classroom/restrictions.ts';

export interface MissionHost {
  /** A hint was read: the network has changed (autosave). */
  changed(): void;
  /** Replaces the network with the solved lab. */
  solve(): void;
  /** Opens a page of the Help view. */
  openDoc(id: string): void;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
const present = <T>(x: T | null): x is T => x !== null;

export class MissionPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly chapter: HTMLElement;
  private readonly fold: HTMLButtonElement;
  private readonly host: MissionHost;
  private readonly policy: Restrictions;
  private topo: Topology;
  private result: Evaluation | null = null;

  constructor(topo: Topology, host: MissionHost, policy: Restrictions) {
    this.topo = topo;
    this.host = host;
    this.policy = policy;
    this.heading = el('h2', { id: 'mission-title' });
    this.chapter = el('p', { class: 'mission-chapter' });
    this.body = el('div', { class: 'mission-body', id: 'mission-body' });
    this.fold = el('button', { type: 'button', class: 'btn btn-quiet mission-fold', 'aria-controls': 'mission-body' });
    this.fold.addEventListener('click', () => this.setFolded(this.root.dataset.folded !== 'true'));
    this.root = el('aside', { class: 'mission', 'aria-labelledby': 'mission-title', hidden: true },
      el('header', { class: 'mission-head' }, el('div', {}, this.chapter, this.heading), this.fold), this.body);
    this.setFolded(false);
    this.render();
  }

  /** Shows the mission of another network (none: the panel hides). */
  attach(topo: Topology): void {
    this.topo = topo;
    this.result = null;
    this.render();
  }

  private setFolded(folded: boolean): void {
    this.root.dataset.folded = String(folded);
    this.body.hidden = folded;
    this.fold.setAttribute('aria-expanded', String(!folded));
    const label = t(folded ? 'mission.ui.unfold' : 'mission.ui.fold');
    this.fold.title = label;
    this.fold.setAttribute('aria-label', label);
    this.fold.textContent = folded ? '▸' : '▾';
  }

  private mission(): Mission | undefined {
    const id = this.topo.mission?.id;
    return id === undefined ? undefined : missionById(id);
  }

  private render(): void {
    const m = this.mission();
    this.root.hidden = !m;
    clear(this.body);
    if (!m) return;
    const ex = EXAMPLES.find((e) => e.id === m.id);
    const group = LAB_GROUPS.find(([, ids]) => ids.includes(m.id))?.[0];
    this.heading.textContent = `${t('mission.ui.panel')} · ${ex ? labText(ex).title : m.id}`;
    this.chapter.textContent = group ? tDynamic(`mission.chapter.${group}`) : '';
    this.body.append(...[this.ticket(m), this.tasks(m), this.actions(), this.report(m), this.solution(m), this.further(m)].filter(present));
  }

  private ticket(m: Mission): HTMLElement {
    const k = `mission.${m.id}`;
    return el('section', { class: 'mission-ticket' },
      el('p', { class: 'mission-from' }, t('mission.ui.from', { who: tDynamic(`${k}.from`) })),
      el('blockquote', {}, tDynamic(`${k}.ticket`)),
      el('details', { class: 'mission-purpose' }, el('summary', {}, t('mission.ui.purpose')), el('p', {}, tDynamic(`${k}.purpose`))));
  }

  /** Levels of hint already read for task `n` (in order: level 2 counts only after level 1). */
  private seen(n: number): number {
    const read = this.topo.mission?.hints ?? [];
    let level = 0;
    while (level < HINT_LEVELS && read.includes(`${n}.${level + 1}`)) level++;
    return level;
  }

  private tasks(m: Mission): HTMLElement {
    return el('section', { class: 'mission-tasks' }, el('h3', {}, t('mission.ui.tasks')), el('ol', {}, ...range(m.tasks).map((n) => this.task(m, n))));
  }

  private task(m: Mission, n: number): HTMLElement {
    const seen = this.seen(n);
    const li = el('li', { 'data-task': String(n) }, el('p', {}, tDynamic(taskKey(m, n))));
    if (seen > 0) {
      li.append(el('ul', { class: 'mission-hints' }, ...range(seen).map((l) =>
        el('li', { tabindex: '-1' }, el('strong', {}, t('mission.ui.hint', { n: l })), ' ', tDynamic(hintKey(m, n, l))))));
    }
    if (this.policy.hints && seen < HINT_LEVELS) {
      li.append(button(t('mission.ui.nextHint', { n: seen + 1, total: HINT_LEVELS }), () => this.reveal(n, seen + 1), 'btn btn-quiet mission-hint-btn'));
    }
    return li;
  }

  /** Records the hint, then moves focus to it so a screen reader reads it out. */
  private reveal(n: number, level: number): void {
    const state = this.topo.mission;
    if (!state) return;
    this.topo.mission = withHint(state, `${n}.${level}`);
    this.host.changed();
    this.render();
    this.body.querySelector<HTMLElement>(`li[data-task="${n}"] .mission-hints > li:last-child`)?.focus();
  }

  private actions(): HTMLElement | null {
    const items = [
      this.policy.missionCheck ? button(t('mission.ui.check'), () => this.check(), 'btn primary') : null,
      this.policy.solution && !this.topo.mission?.solution ? button(t('mission.ui.solution'), () => void this.askSolution(), 'btn btn-quiet') : null,
    ].filter(present);
    return items.length ? el('div', { class: 'mission-actions' }, ...items) : null;
  }

  private check(): void {
    const m = this.mission();
    if (!m) return;
    this.result = evaluate(this.topo.toJSON(), missionRubric(m));
    this.render();
    this.body.querySelector<HTMLElement>('.mission-report')?.focus();
  }

  private hintsUsed(): string {
    const n = this.topo.mission?.hints.length ?? 0;
    if (n === 0) return t('mission.ui.noHints');
    return n === 1 ? t('mission.ui.oneHint') : t('mission.ui.hintsUsed', { n });
  }

  private report(m: Mission): HTMLElement | null {
    const r = this.result;
    if (!r) return null;
    const done = r.score === r.max;
    return el('section', { class: 'mission-report', tabindex: '-1', role: 'status' },
      el('p', { class: 'mission-score', 'data-state': done ? 'ok' : 'failed' }, done ? `${t('mission.ui.done')} · ` : '', t('mission.ui.score', { score: r.score, max: r.max })),
      el('p', { class: 'muted' }, this.hintsUsed()),
      el('ul', { class: 'mission-results' }, ...r.items.map((i) => el('li', { 'data-state': i.passed ? 'ok' : 'failed' },
        el('span', { class: 'mission-mark', 'aria-hidden': 'true' }, i.passed ? '✓' : '✗'),
        el('span', { class: 'visually-hidden' }, `${t(i.passed ? 'mission.ui.passed' : 'mission.ui.failed')}: `),
        el('span', {}, i.title ?? i.id), ' ', el('small', {}, i.detail)))),
      done ? el('blockquote', { class: 'mission-debrief' }, tDynamic(`mission.${m.id}.debrief`)) : null);
  }

  /** After View solution: what was done, and Marta's explanation. */
  private solution(m: Mission): HTMLElement | null {
    if (!this.topo.mission?.solution) return null;
    return el('section', { class: 'mission-solution' },
      el('p', { class: 'muted' }, t('mission.ui.solved')),
      el('details', { open: true }, el('summary', {}, t('mission.ui.solutionShown')),
        el('p', {}, tDynamic(`mission.${m.id}.solution`)),
        el('blockquote', { class: 'mission-debrief' }, tDynamic(`mission.${m.id}.debrief`))));
  }

  private async askSolution(): Promise<void> {
    const ok = await confirmDialog({ title: t('mission.ui.solutionTitle'), body: t('mission.ui.solutionBody'), cancel: t('mission.ui.solutionCancel'), proceed: t('mission.ui.solutionProceed') });
    if (ok) this.host.solve();
  }

  /** Help pages for the mission (only the ones the Help view has, and only when Help is allowed). */
  private further(m: Mission): HTMLElement | null {
    if (!this.policy.docs) return null;
    const pages = [`lab-${m.id}`, ...m.docs].flatMap((id) => findPage(id) ?? []);
    if (!pages.length) return null;
    return el('section', { class: 'mission-docs' }, el('h3', {}, t('mission.ui.docs')),
      el('ul', {}, ...pages.map((p) => el('li', {}, button(p.title, () => this.host.openDoc(p.id), 'btn btn-quiet')))));
  }
}
