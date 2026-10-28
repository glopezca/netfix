/** A file saved in a user's home is restored before the account exists: the home still belongs to the user. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Server } from '../../src/devices/server.ts';

test('after saving and loading the SSH lab, /home/ana is still ana’s and holds her file', () => {
  const ex = EXAMPLES.find((e) => e.id === 'ssh-sftp');
  assert.ok(ex);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(ex.build().toJSON())));
  const srv = [...again.placed.values()].map((p) => p.device).find((d) => d.kind === 'server') as Server;
  const sh = createShell(srv, 'linux', 'root');
  assert.match(sh.run('stat -c "%U:%G %a" /home/ana').join('\n'), /^ana:ana 750$/m);
  assert.match(sh.run('stat -c "%U %n" /home/ana/bienvenida.txt').join('\n'), /^ana \/home\/ana\/bienvenida\.txt$/m);
});
