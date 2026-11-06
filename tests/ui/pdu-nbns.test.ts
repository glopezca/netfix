/**
 * The NBNS lines of the Simulación event list and PDU view: the opcode and the reply code of WINS registrations,
 * refreshes and releases, as Wireshark names them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nbLabel, nbnsFields, nbnsSummary } from '../../src/ui/pdu-nbns.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import type { NbnsMessage } from '../../src/net/packets.ts';

const base: NbnsMessage = { id: 0x1a2b, response: false, type: 'NB', name: 'WIN-B2', suffix: 0x20, broadcast: false };
const row = (n: NbnsMessage, label: string): string | undefined => nbnsFields(n).find(([l]) => l === label)?.[1];

test('the summary names the operation and the name with its suffix', () => {
  assert.equal(nbnsSummary(base), 'NBNS Query WIN-B2<20>');
  assert.equal(nbnsSummary({ ...base, response: true }), 'NBNS Response WIN-B2<20>');
  assert.equal(nbnsSummary({ ...base, opcode: 'registration' }), 'NBNS Registration WIN-B2<20>');
  assert.equal(nbnsSummary({ ...base, opcode: 'refresh', response: true }), 'NBNS Refresh Response WIN-B2<20>');
  assert.equal(nbnsSummary({ ...base, opcode: 'release' }), 'NBNS Release WIN-B2<20>');
  assert.equal(nbnsSummary({ ...base, type: 'NBSTAT', name: '*' }), 'NBNS NBSTAT *');
  assert.equal(nbLabel({ name: 'PC2', suffix: 0 }), 'PC2<00>');
});

test('the fields show the opcode, RD, TTL and the reply code', () => {
  setLocale('en-GB');
  try {
    const answer: NbnsMessage = { ...base, opcode: 'registration', response: true, rd: true, ttl: 300_000, rcode: 0, addresses: [0xc0a8140c] };
    assert.equal(row(answer, 'Transaction ID'), '0x1A2B');
    assert.equal(row(answer, 'Opcode'), 'Registration (5)');
    assert.equal(row(answer, 'RD (recursion desired)'), 'yes');
    assert.equal(row(answer, 'TTL'), '300000 s');
    assert.equal(row(answer, 'Rcode'), 'No error (0)');
    assert.equal(row({ ...answer, rcode: 3 }, 'Rcode'), 'Name error (3)');
    assert.equal(row({ ...answer, rcode: 5 }, 'Rcode'), 'Refused (5)');
    assert.equal(row({ ...answer, rcode: 7 }, 'Rcode'), '7');
    assert.equal(row(base, 'Opcode'), 'Name query (0)');
    assert.equal(row(base, 'RD (recursion desired)'), undefined);
    assert.equal(row(base, 'Rcode'), undefined);
    assert.equal(row({ ...base, ttl: Number.NaN }, 'TTL'), undefined);
    setLocale('es-ES');
    assert.equal(row({ ...base, opcode: 'refresh' }, 'Opcode'), 'Refresco (8)');
    assert.equal(row({ ...answer, rcode: 3 }, 'Rcode'), 'El nombre no existe (3)');
  } finally {
    setLocale('es-ES');
  }
});
