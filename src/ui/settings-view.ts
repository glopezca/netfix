/** The Configuración tab: general settings of this browser and the device settings of the current lab. */
import { el } from './dom.ts';
import { t, tDynamic } from '../i18n/t.ts';
import { LOCALES, LOCALE_NAMES, getLocale, isLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { THEMES, theme, setTheme, confirmUnsaved, setConfirmUnsaved, timestampPrompt, setTimestampPromptPref, onTimestampPrompt } from './preferences.ts';
import { FEATURES_BY_KIND, featureOn, setFeature } from '../net/lab-features.ts';
import type { LabFeatures } from '../net/lab-features.ts';
import type { DeviceKind } from '../net/topology.ts';

/** The kinds whose windows have settings to switch (the cloud has none). */
/** The «prompt con hora» box of the page built last, kept in step when a terminal footer changes it. */
let stampBox: HTMLInputElement | undefined;
onTimestampPrompt(() => { if (stampBox) stampBox.checked = timestampPrompt(); });

const KINDS: readonly DeviceKind[] = ['pc', 'server', 'linuxrouter', 'router', 'switch'];

export interface SettingsHost {
  features(): LabFeatures;
  setFeatures(next: LabFeatures): void;
  /** Embedded in a classroom exercise: the lab section is read-only. */
  labLocked(): boolean;
  /** The classroom fixes the timestamp prompt. */
  promptLocked(): boolean;
  setLocale(l: Locale): void;
}

function generalSection(host: SettingsHost): HTMLElement {
  const lang = el('select', { class: 'select', id: 'set-lang' }, ...LOCALES.map((l) => el('option', { value: l, selected: l === getLocale() }, LOCALE_NAMES[l])));
  lang.addEventListener('change', () => { if (isLocale(lang.value)) host.setLocale(lang.value); });
  const radios = THEMES.map((v) => {
    const r = el('input', { type: 'radio', name: 'set-theme', value: v, checked: v === theme() });
    r.addEventListener('change', () => { if (r.checked) setTheme(v); });
    return el('label', { class: 'set-choice' }, r, tDynamic(`set.theme${v[0]?.toUpperCase()}${v.slice(1)}`));
  });
  const confirm = el('input', { type: 'checkbox', checked: confirmUnsaved() });
  confirm.addEventListener('change', () => setConfirmUnsaved(confirm.checked));
  const stamp = el('input', { type: 'checkbox', checked: timestampPrompt(), disabled: host.promptLocked() });
  stamp.addEventListener('change', () => setTimestampPromptPref(stamp.checked));
  stampBox = stamp;
  return el('section', { class: 'set-section', 'aria-labelledby': 'set-general' },
    el('h2', { id: 'set-general' }, t('set.general')),
    el('p', { class: 'muted' }, t('set.generalNote')),
    el('div', { class: 'set-row' }, el('label', { for: 'set-lang' }, t('set.language')), lang),
    el('fieldset', { class: 'set-group' }, el('legend', {}, t('set.theme')), ...radios),
    el('label', { class: 'set-choice' }, confirm, t('set.confirm')),
    el('label', { class: 'set-choice' }, stamp, t('set.timestamp'), host.promptLocked() ? el('span', { class: 'muted' }, ` ${t('term.timestampLocked')}`) : null));
}

function kindGroup(host: SettingsHost, kind: DeviceKind, changed: () => void): HTMLElement {
  const boxes = FEATURES_BY_KIND[kind].map((id) => {
    const box = el('input', { type: 'checkbox', checked: featureOn(host.features(), kind, id), disabled: host.labLocked(), 'data-feature': `${kind}:${id}` });
    box.addEventListener('change', () => {
      host.setFeatures(setFeature(host.features(), kind, id, box.checked));
      changed();
    });
    return el('label', { class: 'set-choice' }, box, tDynamic(`set.feat.${id}`));
  });
  return el('fieldset', { class: 'set-group', 'data-kind': kind }, el('legend', {}, tDynamic(`set.kind.${kind}`)), ...boxes);
}

export class SettingsView {
  readonly root: HTMLElement;
  private readonly lab: HTMLElement;
  private readonly host: SettingsHost;
  /** Says what changed (the status line of the workspace is hidden on this page). */
  private readonly status = el('p', { class: 'set-status', role: 'status' });

  constructor(host: SettingsHost) {
    this.host = host;
    this.lab = el('section', { class: 'set-section', 'aria-labelledby': 'set-lab' });
    const page = el('article', { class: 'doc-page settings-page', tabindex: '-1' },
      el('h1', {}, t('set.title')), el('p', { class: 'doc-summary' }, t('set.summary')), generalSection(host), this.lab);
    this.root = el('section', { class: 'docs settings', 'aria-label': t('set.label') }, page);
    this.render();
  }

  /** The lab section, from the network open now (called each time the tab is shown). */
  render(): void {
    const host = this.host;
    const reset = el('button', { type: 'button', class: 'btn', disabled: host.labLocked() }, t('set.reset'));
    const changed = (): void => { this.status.textContent = t('set.changed'); };
    reset.addEventListener('click', () => {
      host.setFeatures({});
      this.render();
      changed();
      this.lab.querySelector<HTMLButtonElement>('.set-reset')?.focus();
    });
    reset.classList.add('set-reset');
    this.status.textContent = '';
    this.lab.replaceChildren(
      el('h2', { id: 'set-lab' }, t('set.lab')),
      el('p', { class: 'muted' }, host.labLocked() ? t('set.labLocked') : t('set.labNote')),
      el('p', {}, t('set.always')),
      el('div', { class: 'set-kinds' }, ...KINDS.map((k) => kindGroup(host, k, changed))),
      reset, this.status);
  }
}
