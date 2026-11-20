/** Check types registered from outside the core (extension points): validated like the built-in ones, marked by their own evaluator. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFields, parseChecklist, registerCheckKind } from '../../src/classroom/checklist.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { runOnHost } from '../../src/classroom/host-run.ts';
import { codeLab, CODE_LAB_DEVICE } from '../../src/classroom/code-lab.ts';
import { Topology } from '../../src/net/topology.ts';

const item = (check: unknown): unknown => ({ id: 'a', weight: 2, check });

test('an unregistered type is refused; once registered its fields are validated as the built-in ones', () => {
  assert.throws(() => parseChecklist([item({ type: 'ext-label', device: 'PC0' })]), /type desconocido/);
  registerCheckKind('ext-label', {
    fields: { device: checkFields.label, 'mode?': checkFields.oneOf(['a', 'b']) },
    evaluate: (t, c) => ({ passed: t.placed.size > 0, detail: String(c.device) }),
  });
  const [ok] = parseChecklist([item({ type: 'ext-label', device: 'PC0', mode: 'a' })]);
  assert.deepEqual(ok?.check, { type: 'ext-label', device: 'PC0', mode: 'a' });
  assert.throws(() => parseChecklist([item({ type: 'ext-label' })]), /device es obligatorio/);
  assert.throws(() => parseChecklist([item({ type: 'ext-label', device: 'PC0', mode: 'c' })]), /mode debe ser a o b/);
  assert.throws(() => parseChecklist([item({ type: 'ext-label', device: 'PC0', extra: 1 })]), /campo desconocido «extra»/);
});

test('a type cannot take a built-in name, a bad name or be registered twice', () => {
  const kind = { fields: {}, evaluate: () => ({ passed: true, detail: '' }) };
  assert.throws(() => registerCheckKind('ping', kind), /ya existe/);
  assert.throws(() => registerCheckKind('Bad Name', kind), /nombre/);
  registerCheckKind('ext-once', kind);
  assert.throws(() => registerCheckKind('ext-once', kind), /ya existe/);
});

test('evaluate marks an extension check with its evaluator; one that throws fails the item, not the marking', () => {
  registerCheckKind('ext-throws', { fields: {}, evaluate: () => { throw new Error('boom'); } });
  const file = new Topology().toJSON();
  const r = evaluate(file, parseChecklist([{ id: 'x', weight: 1, check: { type: 'ext-throws' } }, item({ type: 'ext-label', device: 'PC0' })]));
  assert.deepEqual(r.items.map((i) => [i.id, i.passed, i.detail]), [['x', false, 'No se pudo comprobar este elemento.'], ['a', false, 'PC0']]);
  assert.equal(r.max, 3);
});

test('runOnHost runs a line in a host\'s shell, from its home folder, or says why it cannot', () => {
  const t = Topology.fromJSON(codeLab('linux', [{ path: 'hola.sh', content: 'echo hola\n' }]));
  assert.deepEqual(runOnHost(t, CODE_LAB_DEVICE, 'linux', 'bash hola.sh'), { output: ['hola'] });
  assert.deepEqual(runOnHost(t, 'nadie', 'linux', 'ls'), { error: 'No existe el equipo «nadie».' });
});
