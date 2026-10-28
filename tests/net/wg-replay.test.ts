/**
 * WireGuard replay protection: the initiation carries a TAI64N timestamp (authenticated with the handshake) and the
 * responder ignores one that is not newer than the last it accepted from that peer; data messages are checked
 * against a sliding window of counters, so a captured packet sent again is dropped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WgInterface, tai64n } from '../../src/devices/wireguard.ts';
import type { WgHost } from '../../src/devices/wireguard.ts';
import { encodeKey, publicKeyOf, randomKey } from '../../src/core/x25519.ts';
import type { IpPacket, WgMessage } from '../../src/net/packets.ts';

interface Sent { readonly dst: number; readonly msg: WgMessage }

const A_IP = 1;
const B_IP = 2;

function pair() {
  let now = 1_000_000;
  const wire: Sent[] = [];
  const received: IpPacket[] = [];
  const host = (): WgHost => ({
    now: () => now,
    schedule: () => undefined,
    sendUdp: (dst, _dport, _sport, msg) => { wire.push({ dst, msg }); },
    receiveInner: (_iface, inner) => { received.push(inner); },
  });
  const ka = randomKey();
  const kb = randomKey();
  const a = new WgInterface('wg0', host());
  const b = new WgInterface('wg0', host());
  a.setConfig({ privateKey: encodeKey(ka), peers: [{ publicKey: encodeKey(publicKeyOf(kb)), allowedIps: [{ ip: B_IP, prefix: 32 }], endpoint: { ip: B_IP, port: 51820 } }] });
  b.setConfig({ privateKey: encodeKey(kb), peers: [{ publicKey: encodeKey(publicKeyOf(ka)), allowedIps: [{ ip: A_IP, prefix: 32 }], endpoint: { ip: A_IP, port: 51820 } }] });
  /** Delivers everything on the wire (and what it triggers) to its destination. */
  const deliver = (): Sent[] => {
    const seen: Sent[] = [];
    while (wire.length) {
      const s = wire.shift() as Sent;
      seen.push(s);
      (s.dst === B_IP ? b : a).receive(s.dst === B_IP ? A_IP : B_IP, 51820, s.msg);
    }
    return seen;
  };
  return { a, b, wire, received, deliver, tick: (ms: number) => { now += ms; } };
}

const ping = (n: number): IpPacket => ({ src: A_IP, dst: B_IP, ttl: 64, protocol: 'icmp', icmp: { type: 'echo-request', id: 1, seq: n } });

test('TAI64N: 2^62 + 10 + seconds, then nanoseconds, as 12 bytes in hex', () => {
  assert.equal(tai64n(0), '400000000000000a00000000');
  assert.equal(tai64n(1_500), '400000000000000b1dcd6500');
});

test('a replayed initiation is ignored: no response and the session stays', () => {
  const lab = pair();
  lab.a.send(ping(1));
  const first = lab.deliver();
  const init = first.find((s) => s.msg.kind === 'initiation');
  assert.ok(init);
  assert.equal(lab.received.length, 1, 'the handshake completes and the ping arrives');
  const session = lab.b.peers.values().next().value?.session;
  lab.tick(30_000);
  lab.b.receive(A_IP, 51820, init.msg);
  assert.equal(lab.wire.length, 0, 'no response to the replay');
  assert.equal(lab.b.peers.values().next().value?.session, session, 'the session is not replaced');
});

test('a new initiation from the same peer, later, is accepted', () => {
  const lab = pair();
  lab.a.send(ping(1));
  lab.deliver();
  lab.tick(200_000);
  lab.a.send(ping(2));
  const again = lab.deliver();
  assert.ok(again.some((s) => s.msg.kind === 'response'));
  assert.equal(lab.received.length, 2);
});

test('a data message sent again is dropped; an older one within the window still arrives once', () => {
  const lab = pair();
  lab.a.send(ping(1));
  lab.deliver();
  lab.a.send(ping(2));
  lab.a.send(ping(3));
  const two = lab.wire.shift() as Sent;
  const three = lab.wire.shift() as Sent;
  lab.b.receive(A_IP, 51820, three.msg);
  lab.b.receive(A_IP, 51820, two.msg);
  lab.b.receive(A_IP, 51820, two.msg);
  lab.b.receive(A_IP, 51820, three.msg);
  assert.deepEqual(lab.received.map((p) => p.icmp?.seq), [1, 3, 2]);
});
