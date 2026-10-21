/** Services → Firewall (nftables) and Services → sysctl panels of Ubuntu servers and the Linux router. */
import { el } from './dom.ts';
import { button, input, message, onOff, select, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { Chain, Rule, Table } from '../net/nft/model.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';
import { ruleText } from '../net/nft/format.ts';
import { runNft } from '../net/nft/apply.ts';
import { moveRule, nftEdit, NFT_TEMPLATES } from '../net/nft/edit.ts';
import { applyAndSave, firewallStatus, setFirewallActive } from '../shells/firewall-save.ts';
import { saveSysctl } from '../shells/kernel-save.ts';
import { SYSCTL_KEYS } from '../net/sysctl.ts';
import { chainForm, ruleForm, tableForm } from './firewall-forms.ts';
import type { Commit } from './firewall-forms.ts';
import { t } from '../i18n/t.ts';

function header(s: Server, app: AfterChange, fail: (m: string) => void): HTMLElement[] {
  const st = firewallStatus(s);
  const tpl = select([['', t('fw.tpl.none')], ['hardening', t('fw.tpl.hardening')], ['router', t('fw.tpl.router')], ['open', t('fw.tpl.open')]], '');
  const load = (): void => {
    const text = NFT_TEMPLATES[tpl.value];
    if (!text || !globalThis.confirm(t('fw.confirmTemplate'))) return;
    const r = runNft(EMPTY_RULESET, text);
    if (!r.ok) return fail(r.error);
    applyAndSave(s, r.ruleset);
    app.afterCommand();
  };
  return [
    el('p', { class: 'muted' }, t('fw.intro')),
    onOff(t('fw.service'), st.active, (on) => { setFirewallActive(s, on); app.afterCommand(); }),
    el('p', { class: 'status', 'data-state': st.saved ? 'ok' : 'failed' }, st.saved ? t('fw.saved') : t('fw.unsaved')),
    ...(st.saved ? [] : [el('div', { class: 'row-actions' },
      button(t('fw.save'), () => { applyAndSave(s, s.kernel.netfilter.ruleset); app.afterCommand(); }),
      button(t('fw.reload'), () => { const err = s.reloadFirewall(); if (err) fail(err); app.afterCommand(); }))]),
    el('div', { class: 'row-actions' }, tpl, button(t('fw.loadTemplate'), load)),
  ];
}

function rulesOf(s: Server, tb: Table, ch: Chain, commit: Commit, app: AfterChange): HTMLElement {
  const counters = s.kernel.netfilter.counters;
  const move = (r: Rule, d: -1 | 1): void => {
    applyAndSave(s, moveRule(s.kernel.netfilter.ruleset, tb.family, tb.name, ch.name, r.handle, d));
    app.afterCommand();
  };
  return table<Rule>(ch.rules, [{ label: t('fw.rules'), value: (r) => ruleText(r, tb.family, counters), mono: true }], {
    empty: t('fw.noRules'),
    actions: (r) => [button('↑', () => move(r, -1), 'btn btn-small'), button('↓', () => move(r, 1), 'btn btn-small')],
    onDelete: (r) => { commit(`delete rule ${tb.family} ${tb.name} ${ch.name} handle ${r.handle}`); },
  });
}

function chainView(s: Server, tb: Table, ch: Chain, commit: Commit, app: AfterChange): HTMLElement {
  const b = ch.base;
  const policy = b ? select([['accept', 'accept'], ['drop', 'drop']], b.policy) : undefined;
  policy?.addEventListener('change', () => { if (b) commit(`add chain ${tb.family} ${tb.name} ${ch.name} { type ${b.type} hook ${b.hook} priority ${b.priority}; policy ${policy.value}; }`); });
  const del = button(t('fw.deleteChain'), () => { commit(`flush chain ${tb.family} ${tb.name} ${ch.name}\ndelete chain ${tb.family} ${tb.name} ${ch.name}`); }, 'btn btn-small danger');
  return el('div', { class: 'fw-chain' },
    el('div', { class: 'fw-chain-head' }, el('strong', { class: 'mono' }, `chain ${ch.name}`),
      el('span', { class: 'muted mono' }, b ? ` type ${b.type} hook ${b.hook} priority ${b.priority}` : ''), ...(policy ? [el('label', { class: 'inline' }, `${t('fw.policy')} `, policy)] : []), del),
    rulesOf(s, tb, ch, commit, app));
}

function tablesView(s: Server, commit: Commit, app: AfterChange, fail: (m: string) => void): HTMLElement[] {
  const rs = s.kernel.netfilter.ruleset;
  const tables = rs.tables.map((tb) => el('section', { class: 'fw-table' },
    el('h4', { class: 'mono' }, `table ${tb.family} ${tb.name}`, ' ', button(t('fw.deleteTable'), () => { commit(`delete table ${tb.family} ${tb.name}`); }, 'btn btn-small danger')),
    ...tb.chains.map((ch) => chainView(s, tb, ch, commit, app)),
    chainForm(tb.family, tb.name, commit, fail)));
  return [el('h3', {}, t('fw.tables')), ...(tables.length ? tables : [el('p', { class: 'muted' }, t('fw.noTables'))]), tableForm(commit, fail), ruleForm(rs, commit, fail)];
}

export function firewallPanel(s: Server, app: AfterChange): LivePanel {
  // Outside the redraw: an action that changes the device redraws the panel before reporting.
  const msg = message();
  return liveHostPanel(s, () => {
    if (s.os !== 'linux') return [el('p', { class: 'muted' }, t('fw.notLinux'))];
    const fail = (m: string): void => msg.error(m);
    const commit: Commit = (command) => {
      const r = nftEdit(s.kernel.netfilter.ruleset, command);
      // Every edit reports its error here (also the delete and policy buttons, which ignore the result).
      if (!r.ok) { fail(r.error); return r.error; }
      applyAndSave(s, r.ruleset);
      app.afterCommand();
      return null;
    };
    const listed = runNft(s.kernel.netfilter.ruleset, 'list ruleset', { format: { counters: s.kernel.netfilter.counters } });
    return [
      ...header(s, app, fail), msg.el, ...tablesView(s, commit, app, fail),
      el('h3', {}, t('fw.preview')), el('pre', { class: 'code-view' }, listed.ok ? listed.output.join('\n') : ''),
    ];
  });
}

/** «Activar router»: mirrors net.ipv4.ip_forward and cannot be clicked (the parameter is what changes it). */
function routerFlag(s: Server): HTMLElement[] {
  if (s.kind !== 'linuxrouter') return [];
  const box = el('input', { type: 'checkbox', checked: s.kernel.sysctl.enabled('net.ipv4.ip_forward'), disabled: true });
  return [el('label', { class: 'router-flag' }, box,
    el('span', {}, el('strong', {}, t('sysctl.router')), el('span', { class: 'muted router-flag-help' }, t('sysctl.routerHelp'))))];
}

export function sysctlPanel(s: Server, app: AfterChange): LivePanel {
  // Outside the redraw: an action that changes the device redraws the panel before reporting.
  const msg = message();
  return liveHostPanel(s, () => {
    const keys = [...SYSCTL_KEYS].sort((a, b) => Number(b.effect) - Number(a.effect) || a.name.localeCompare(b.name));
    const rows = keys.map((k) => {
      const current = s.kernel.sysctl.get(k.name) ?? '';
      const ctrl = Array.isArray(k.accepts) ? select(k.accepts.map((v) => [v, v] as const), current) : input({ value: current, 'aria-label': k.name });
      const apply = (): void => { const err = saveSysctl(s, k.name, ctrl.value.trim()); if (err) msg.error(err); app.afterCommand(); };
      return el('tr', {}, el('td', { class: 'mono' }, k.name), el('td', {}, ctrl), el('td', {}, k.effect ? t('sysctl.yes') : t('sysctl.no')), el('td', {}, button(t('sysctl.apply'), apply, 'btn btn-small')));
    });
    return [...routerFlag(s), el('p', { class: 'muted' }, t('sysctl.intro')), msg.el,
      el('table', { class: 'grid-table' }, el('thead', {}, el('tr', {}, el('th', {}, t('sysctl.key')), el('th', {}, t('sysctl.value')), el('th', {}, t('sysctl.effect')), el('th', {}))), el('tbody', {}, ...rows))];
  });
}
