/**
 * The NetBIOS Name Service rows of the Simulación PDU view and the event summary, as Wireshark names them: header
 * (Transaction ID, opcode, RD, broadcast), question, TTL, reply code, answers and the NBSTAT name table.
 */
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import type { NbnsMessage, NbnsOpcode } from '../net/packets.ts';
import { formatIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';

/** RFC 1002 opcodes (what Wireshark shows in brackets). */
const OPCODES: Readonly<Record<NbnsOpcode, { readonly code: number; readonly summary: string; readonly key: MessageKey }>> = {
  query: { code: 0, summary: 'Query', key: 'pdu.nbOp.query' },
  registration: { code: 5, summary: 'Registration', key: 'pdu.nbOp.registration' },
  release: { code: 6, summary: 'Release', key: 'pdu.nbOp.release' },
  refresh: { code: 8, summary: 'Refresh', key: 'pdu.nbOp.refresh' },
};
const RCODES: Readonly<Record<number, MessageKey>> = { 0: 'pdu.nbRcode.ok', 3: 'pdu.nbRcode.nam', 5: 'pdu.nbRcode.rfs' };

export const nbLabel = (n: { readonly name: string; readonly suffix: number }): string =>
  (n.name === '*' ? '*' : `${n.name}<${n.suffix.toString(16).toUpperCase().padStart(2, '0')}>`);

/** The event list line: «NBNS Query PC2<00>», «NBNS Registration Response WIN-B2<00>», «NBNS NBSTAT *». */
export function nbnsSummary(n: NbnsMessage): string {
  if (n.type === 'NBSTAT') return `NBNS NBSTAT ${nbLabel(n)}`;
  const op = n.opcode ?? 'query';
  const what = op === 'query' ? (n.response ? 'Response' : 'Query') : `${OPCODES[op].summary}${n.response ? ' Response' : ''}`;
  return `NBNS ${what} ${nbLabel(n)}`;
}

const rcodeText = (r: number): string => {
  const key = RCODES[r];
  return key ? `${t(key)} (${r})` : String(r);
};

/** [label, value] rows; undefined values are left out by the view. */
export function nbnsFields(n: NbnsMessage): [string, string | undefined][] {
  const op = n.opcode ?? 'query';
  return [
    ['Transaction ID', `0x${n.id.toString(16).toUpperCase().padStart(4, '0')}`], ['QR', n.response ? t('pdu.response') : t('pdu.query')],
    ['Opcode', `${t(OPCODES[op].key)} (${OPCODES[op].code})`],
    ['RD (recursion desired)', n.rd ? t('pdu.yes') : undefined],
    [t('pdu.question'), `${nbLabel(n)} ${n.type}`], ['B-node (broadcast)', n.broadcast ? t('pdu.yes') : undefined],
    ['TTL', n.ttl !== undefined && Number.isFinite(n.ttl) ? `${n.ttl} s` : undefined],
    ['Rcode', n.rcode !== undefined ? rcodeText(n.rcode) : undefined],
    [t('pdu.answers'), n.addresses?.map(formatIp).join(', ')],
    [t('pdu.nbNames'), n.names?.map((x) => `${nbLabel(x)}${x.group ? ' GROUP' : ''}`).join(' · ')], ['MAC', n.mac ? formatMacCisco(n.mac) : undefined],
  ];
}
