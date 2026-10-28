/**
 * The English documentation (src/docs/en) mirrors the Spanish one: same exports, page ids, block kinds,
 * table and list shapes, record keys, and code blocks with the same lines (a line that starts with a
 * command keeps that command; prose lines inside a code block may be translated).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { DocBlock, DocPage } from '../../src/docs/types.ts';

const DOCS = ['outline', 'netfix', 'ios', 'ios-dhcp', 'ios-sec', 'services', 'dns', 'http', 'mail', 'ssh', 'webapps', 'internet', 'security', 'clients', 'linux', 'editors', 'bash-lang', 'bash-ref', 'utils', 'bash-builtins'];

const isPage = (v: unknown): v is DocPage => typeof v === 'object' && v !== null && 'blocks' in v && 'id' in v;
function pagesOf(v: unknown): readonly DocPage[] | null {
  const arr = Array.isArray(v) ? v : typeof v === 'object' && v !== null && 'pages' in v ? (v as { pages: unknown }).pages : null;
  return Array.isArray(arr) && arr.length > 0 && arr.every(isPage) ? arr : null;
}

/** First word of a line when it looks like code (a lowercase command, a path, a flag, a prompt…). */
function codeWord(line: string): string | null {
  const w = line.trim().split(/\s+/)[0] ?? '';
  return /^[a-z0-9_./$#!:\-[{<>|&;=*~@"'`]/.test(w) && !/^\(/.test(w) ? w : null;
}

/** A figure without its texts: the same nodes, positions, links and messages in both languages. */
function shape(f: Extract<DocBlock, { kind: 'figure' }>['figure']): unknown {
  return f.type === 'topology' ? f.nodes.map((n) => [n.id, n.kind, n.x, n.y]).concat(f.links.map((l) => [l.a, l.b])) : f.messages.map((m) => [m.from, m.to, m.text]);
}

function compareBlocks(where: string, es: readonly DocBlock[], en: readonly DocBlock[], bad: string[]): void {
  if (es.length !== en.length) { bad.push(`${where}: ${es.length} blocks vs ${en.length}`); return; }
  es.forEach((b, i) => {
    const e = en[i] as DocBlock;
    if (b.kind !== e.kind) { bad.push(`${where} #${i}: ${b.kind} vs ${e.kind}`); return; }
    if (b.kind === 'code' && e.kind === 'code') {
      const [a, c] = [b.text.split('\n'), e.text.split('\n')];
      if (a.length !== c.length) bad.push(`${where} code #${i}: ${a.length} lines vs ${c.length}`);
      else a.forEach((l, j) => { const w = codeWord(l); if (w !== null && w !== (c[j] ?? '').trim().split(/\s+/)[0]) bad.push(`${where} code #${i}:${j}: ${w}`); });
    }
    if (b.kind === 'term' && e.kind === 'term' && (b.lang !== e.lang || b.text.split('\n').length !== e.text.split('\n').length)) bad.push(`${where} term #${i}`);
    else if (b.kind === 'term' && e.kind === 'term' && ['shell', 'ios', 'cmd'].includes(b.lang)) {
      const [a, c] = [b.text.split('\n'), e.text.split('\n')];
      a.forEach((l, j) => { if (l !== c[j] && codeWord(l) !== null && codeWord(l) !== (c[j] ?? '').trim().split(/\s+/)[0]) bad.push(`${where} term #${i}:${j}`); });
    }
    if (b.kind === 'steps' && e.kind === 'steps' && b.items.length !== e.items.length) bad.push(`${where} steps #${i}`);
    if (b.kind === 'callout' && e.kind === 'callout' && (b.tone !== e.tone || (b.solution === undefined) !== (e.solution === undefined))) bad.push(`${where} callout #${i}`);
    if (b.kind === 'figure' && e.kind === 'figure' && JSON.stringify(shape(b.figure)) !== JSON.stringify(shape(e.figure))) bad.push(`${where} figure #${i}`);
    if (b.kind === 'table' && e.kind === 'table' && (b.head.length !== e.head.length || b.rows.length !== e.rows.length)) bad.push(`${where} table #${i}`);
    if (b.kind === 'list' && e.kind === 'list' && b.items.length !== e.items.length) bad.push(`${where} list #${i}`);
  });
}

async function compareModule(name: string, bad: string[]): Promise<void> {
  const es = await import(`../../src/docs/${name}.ts`) as Record<string, unknown>;
  const en = await import(`../../src/docs/en/${name}.ts`) as Record<string, unknown>;
  for (const [key, val] of Object.entries(es)) {
    if (!(key in en)) { bad.push(`${name}: missing export ${key}`); continue; }
    const [a, b] = [pagesOf(val), pagesOf(en[key])];
    if (a && b) {
      if (a.map((p) => p.id).join() !== b.map((p) => p.id).join()) bad.push(`${name}.${key}: page ids differ`);
      a.forEach((p, i) => { const q = b[i]; if (q) compareBlocks(`${name}/${p.id}`, p.blocks, q.blocks, bad); });
    } else if (Array.isArray(val)) {
      if (!Array.isArray(en[key]) || val.length !== (en[key] as unknown[]).length) bad.push(`${name}.${key}: length differs`);
    } else if (val && typeof val === 'object') {
      if (Object.keys(val).sort().join() !== Object.keys(en[key] as object).sort().join()) bad.push(`${name}.${key}: keys differ`);
    }
  }
}

test('every Spanish docs module has an English twin', () => {
  const en = readdirSync(new URL('../../src/docs/en/', import.meta.url)).map((f) => f.replace(/\.ts$/, '')).sort();
  assert.deepEqual(en, [...DOCS].sort());
});

test('English docs mirror the Spanish structure', async () => {
  const bad: string[] = [];
  for (const name of DOCS) await compareModule(name, bad);
  assert.deepEqual(bad, []);
});

test('the Help tab and man follow the interface language', async () => {
  const { docGroups, manPage, findPage, searchDocs } = await import('../../src/docs/index.ts');
  const { setLocale } = await import('../../src/i18n/locale.ts');
  try {
    setLocale('en-GB');
    assert.equal(docGroups().find((g) => g.id === 'linux')?.title, 'Linux Terminal');
    assert.equal(findPage('ios-ipsec')?.id, 'ios-ipsec');
    assert.match(manPage('ls') ?? '', /SEE ALSO\n\s+The Help tab/);
    assert.match(manPage('bash') ?? '', /version 5\.3\.20 in Netfix/);
    assert.ok(searchDocs('wireguard').length > 0);
    setLocale('es-ES');
    assert.equal(docGroups().find((g) => g.id === 'linux')?.title, 'Terminal Linux');
    assert.match(manPage('ls') ?? '', /La pestaña Ayuda/);
  } finally {
    setLocale('es-ES');
  }
});

test('help and man of a builtin speak the interface language', async () => {
  const { setLocale } = await import('../../src/i18n/locale.ts');
  const { BashSession } = await import('../../src/bash/shell.ts');
  const { makeEnv, USER } = await import('../bash/harness.ts');
  try {
    setLocale('en-GB');
    const sh = new BashSession(makeEnv(), USER);
    assert.match(sh.input('help'), /Shell builtins\. Type `help name`/);
    assert.match(sh.input('man cd'), /cd is a bash builtin: try “help cd”/);
  } finally {
    setLocale('es-ES');
  }
});
