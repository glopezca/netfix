/** Forms of the firewall panel: new table, new chain and new rule (built with nft/edit.ts). */
import { el } from './dom.ts';
import { button, field, input, select } from './forms.ts';
import type { Family, Ruleset } from '../net/nft/model.ts';
import { ruleFromForm } from '../net/nft/edit.ts';
import type { FormAction, RuleForm } from '../net/nft/edit.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';

/** Runs an nft command against the running ruleset and applies + saves it; returns an error or null. */
export type Commit = (command: string) => string | null;

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const HOOKS = ['input', 'forward', 'output', 'prerouting', 'postrouting'] as const;
const FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  iif: 'fw.iif', oif: 'fw.oif', saddr: 'fw.saddr', daddr: 'fw.daddr', proto: 'fw.proto', dport: 'fw.dport', ct: 'fw.ct', to: 'fw.to', log: 'fw.log', comment: 'fw.comment',
};

export function tableForm(commit: Commit, fail: (m: string) => void): HTMLElement {
  const family = select([['inet', 'inet'], ['ip', 'ip']], 'inet');
  const name = input({ placeholder: 'filter', 'aria-label': t('fw.name') });
  const add = (): void => {
    if (!NAME.test(name.value.trim())) return fail(t('fw.badField', { field: t('fw.name') }));
    const err = commit(`add table ${family.value} ${name.value.trim()}`);
    if (err) fail(err);
  };
  return el('div', { class: 'fw-form' }, el('div', { class: 'grid2' }, field(t('fw.family'), family), field(t('fw.name'), name)), button(t('fw.addTable'), add));
}

export function chainForm(family: Family, table: string, commit: Commit, fail: (m: string) => void): HTMLElement {
  const name = input({ placeholder: 'input', 'aria-label': t('fw.name') });
  const type = select([['filter', 'filter'], ['nat', 'nat'], ['', t('fw.regular')]], 'filter');
  const hook = select(HOOKS.map((h) => [h, h] as const), 'input');
  const prio = input({ value: '0', inputmode: 'numeric', 'aria-label': t('fw.priority') });
  const policy = select([['accept', 'accept'], ['drop', 'drop']], 'accept');
  const add = (): void => {
    const n = name.value.trim();
    if (!NAME.test(n)) return fail(t('fw.badField', { field: t('fw.name') }));
    if (type.value && !/^-?\d{1,4}$/.test(prio.value.trim())) return fail(t('fw.badField', { field: t('fw.priority') }));
    const spec = type.value ? ` { type ${type.value} hook ${hook.value} priority ${prio.value.trim()}; policy ${policy.value}; }` : '';
    const err = commit(`add chain ${family} ${table} ${n}${spec}`);
    if (err) fail(err);
  };
  return el('details', { class: 'fw-form' }, el('summary', {}, t('fw.addChain')),
    el('div', { class: 'grid2' }, field(t('fw.name'), name), field(t('fw.chainType'), type), field(t('fw.hook'), hook), field(t('fw.priority'), prio), field(t('fw.policy'), policy)),
    button(t('fw.addChain'), add));
}

interface RuleInputs {
  readonly target: HTMLSelectElement;
  readonly text: Readonly<Record<'iif' | 'oif' | 'saddr' | 'daddr' | 'dport' | 'to' | 'log' | 'comment', HTMLInputElement>>;
  readonly proto: HTMLSelectElement;
  readonly action: HTMLSelectElement;
  readonly ct: readonly HTMLInputElement[];
  readonly counter: HTMLInputElement;
  readonly top: HTMLInputElement;
}

function readForm(i: RuleInputs): RuleForm {
  const v = (k: keyof RuleInputs['text']): string | undefined => i.text[k].value.trim() || undefined;
  return {
    iif: v('iif'), oif: v('oif'), saddr: v('saddr'), daddr: v('daddr'), dport: v('dport'), to: v('to'), log: v('log'), comment: v('comment'),
    proto: i.proto.value as RuleForm['proto'], action: i.action.value as FormAction,
    ct: i.ct.filter((c) => c.checked).map((c) => c.value), counter: i.counter.checked,
  };
}

function ruleInputs(rs: Ruleset): RuleInputs {
  const chains = rs.tables.flatMap((tb) => tb.chains.map((c) => [`${tb.family} ${tb.name} ${c.name}`, `${tb.family} ${tb.name} · ${c.name}`] as const));
  const text = (k: string, ph: string): HTMLInputElement => input({ placeholder: ph, 'aria-label': k });
  return {
    target: select(chains, chains[0]?.[0] ?? ''),
    text: { iif: text('iif', 'eth1'), oif: text('oif', 'eth0'), saddr: text('saddr', '192.168.1.0/24'), daddr: text('daddr', '10.0.0.2'), dport: text('dport', '22'), to: text('to', '172.16.0.80:80'), log: text('log', 'DROP '), comment: text('comment', '') },
    proto: select([['', t('fw.any')], ['tcp', 'tcp'], ['udp', 'udp'], ['icmp', 'icmp']], ''),
    action: select(['accept', 'drop', 'reject', 'masquerade', 'snat', 'dnat'].map((a) => [a, a] as const), 'accept'),
    ct: ['new', 'established', 'related', 'invalid'].map((s) => el('input', { type: 'checkbox', value: s })),
    counter: el('input', { type: 'checkbox', checked: true }),
    top: el('input', { type: 'checkbox' }),
  };
}

export function ruleForm(rs: Ruleset, commit: Commit, fail: (m: string) => void): HTMLElement {
  const i = ruleInputs(rs);
  const add = (): void => {
    const body = ruleFromForm(readForm(i));
    if (typeof body !== 'string') return fail(t('fw.badField', { field: t(FIELD_LABEL[body.error] ?? 'fw.action') }));
    if (!i.target.value) return fail(t('fw.badField', { field: t('fw.target') }));
    const err = commit(`${i.top.checked ? 'insert' : 'add'} rule ${i.target.value} ${body}`);
    if (err) fail(err);
  };
  const tx = i.text;
  return el('div', { class: 'fw-form' },
    el('h3', {}, t('fw.addRule')),
    el('div', { class: 'grid2' },
      field(t('fw.target'), i.target), field(t('fw.action'), i.action), field(t('fw.iif'), tx.iif), field(t('fw.oif'), tx.oif),
      field(t('fw.saddr'), tx.saddr), field(t('fw.daddr'), tx.daddr), field(t('fw.proto'), i.proto), field(t('fw.dport'), tx.dport),
      field(t('fw.to'), tx.to), field(t('fw.log'), tx.log), field(t('fw.comment'), tx.comment)),
    el('fieldset', { class: 'mode' }, el('legend', {}, t('fw.ct')), ...i.ct.map((c) => el('label', { class: 'check' }, c, c.value))),
    el('label', { class: 'check' }, i.counter, t('fw.counter')),
    el('label', { class: 'check' }, i.top, t('fw.atStart')),
    button(t('fw.addRule'), add));
}
